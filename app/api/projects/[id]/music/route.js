import {
  callRpc,
  deleteRows,
  guard,
  insertRows,
  requireSecret,
  safeError,
  selectOne,
  selectRows,
  updateRows,
} from '../../../../../lib/cinexvideo-server';
import { AT_COST_POLICY, atCostCredits, isAtCostUser } from '../../../../../lib/billing/at-cost';
import { rateLimit } from '../../../../../lib/rate-limit';
import {
  alignLyrics,
  buildTimeline,
  normalizeTimedLines,
  parseLyrics,
  timelineToScenes,
} from '../../../../../lib/music/lyrics';
import { projectSong, withSongFile } from '../../../../../lib/music/audio';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALIGN_POLICY = 'lyric-timing-2026-10-15-v1';
const MAX_SONG_MS = 10 * 60 * 1000;
const MAX_SONG_BYTES = 24 * 1024 * 1024; // transcription upload limit is 25 MB

async function ownedProject(id, user, admin) {
  if (!UUID_RE.test(id || '')) return null;
  const project = await selectOne('projects', { id: `eq.${id}` }, 'id,owner_id,lane,director_plan,visual_identity');
  if (!project || (project.owner_id !== user.id && !admin)) return null;
  return project;
}

function musicOf(project) {
  return project.director_plan?.music || null;
}

async function saveMusic(project, music) {
  const plan = { ...(project.director_plan || {}), music };
  return updateRows('projects', { id: `eq.${project.id}` }, { director_plan: plan });
}

/** Credits for timing a song of this length (purchased credits only). */
async function alignmentCredits(durationMs, atCost) {
  const minutes = Math.max(1, Math.ceil(durationMs / 60000));
  const rule = await selectOne(
    'model_cost_rules',
    { provider: 'eq.openai', model: 'eq.whisper-1', operation: 'eq.alignment', active: 'eq.true' },
    'provider_cost_cents'
  );
  if (!rule) return null;
  const cost = Number(rule.provider_cost_cents) * minutes;
  if (atCost) return atCostCredits(cost);
  const quote = await callRpc('quote_generation', {
    p_provider: 'openai',
    p_model: 'whisper-1',
    p_operation: 'alignment',
    p_provider_cost_cents: cost,
    p_duration_seconds: Math.ceil(durationMs / 1000),
    p_resolution: null,
    p_reference_count: 0,
  });
  const row = Array.isArray(quote.data) ? quote.data[0] : quote.data;
  return quote.ok && row?.approved ? Number(row.credits) : null;
}

async function transcribe(file, lyricsHint) {
  const { readFile } = await import('node:fs/promises');
  const bytes = await readFile(file);
  if (bytes.length > MAX_SONG_BYTES) throw new Error('song too large to time');
  const form = new FormData();
  form.append('file', new Blob([bytes]), 'song.mp3');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  form.append('language', 'en');
  // Whisper reads up to ~224 tokens of prompt: the start of the real lyrics
  // steers spelling of slang and patois.
  if (lyricsHint) form.append('prompt', lyricsHint.slice(0, 800));
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireSecret('OPENAI_API_KEY')}` },
    body: form,
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) {
    console.error('lyric timing failed', response.status, (await response.text().catch(() => '')).slice(0, 300));
    throw new Error('transcription failed');
  }
  const data = await response.json();
  return Array.isArray(data.words) ? data.words : [];
}

function cleanCast(input, parsed) {
  const given = Array.isArray(input) ? input : [];
  return parsed.map((c) => {
    const edit = given.find((g) => g?.key === c.key) || {};
    return {
      key: c.key,
      label: String(edit.label || c.label).slice(0, 60),
      group: Boolean(edit.group ?? c.group),
      description: String(edit.description ?? c.description ?? '').slice(0, 400),
    };
  });
}

/** Current music timing state for the Studio. */
export async function GET(request, { params }) {
  const { user, admin, superAdmin, error } = await guard(request);
  if (error) return error;
  const { id } = await params;
  const project = await ownedProject(id, user, admin);
  if (!project) return safeError('Project not found.', 404);
  const song = await projectSong(project.id);
  const music = musicOf(project);
  const lyrics = String(project.director_plan?.lyrics || '');
  const parsed = parseLyrics(lyrics);
  const durationMs = Number(new URL(request.url).searchParams.get('duration_ms')) || music?.duration_ms || 0;
  const credits = durationMs > 0 ? await alignmentCredits(durationMs, isAtCostUser({ superAdmin })) : null;
  return Response.json({
    has_song: Boolean(song),
    song_id: song?.id || null,
    lyrics,
    music: music || null,
    parsed_lines: parsed.lines.length,
    cast: music?.cast || parsed.cast,
    timing_credits: credits,
  });
}

export async function POST(request, { params }) {
  const { user, admin, superAdmin, error } = await guard(request, { blockOnMaintenance: true });
  if (error) return error;
  const limited = rateLimit(`music:${user.id}`, { limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const { id } = await params;
  const project = await ownedProject(id, user, admin);
  if (!project) return safeError('Project not found.', 404);
  const atCost = isAtCostUser({ superAdmin });

  let body;
  try { body = await request.json(); } catch { return safeError('Invalid request.', 400); }
  const action = body?.action;

  if (action === 'lyrics') {
    const lyrics = String(body.lyrics || '').slice(0, 20000);
    const plan = { ...(project.director_plan || {}), lyrics };
    const saved = await updateRows('projects', { id: `eq.${project.id}` }, { director_plan: plan });
    if (!saved.ok) return safeError('Lyrics could not be saved.', 500);
    return Response.json({ ok: true, cast: parseLyrics(lyrics).cast, lines: parseLyrics(lyrics).lines.length });
  }

  if (action === 'align') {
    const song = await projectSong(project.id);
    if (!song) return safeError('Upload your song first.', 409);
    const lyrics = String(project.director_plan?.lyrics || '');
    const parsed = parseLyrics(lyrics);
    if (!parsed.lines.length) return safeError('Add your lyrics first so every line can be timed.', 409);
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey) return safeError('An idempotency key is required.', 400);

    try {
      return await withSongFile(song, async ({ file, durationMs }) => {
        if (durationMs > MAX_SONG_MS) return safeError('Songs can be up to 10 minutes long.', 409);
        const credits = await alignmentCredits(durationMs, atCost);
        if (!credits) return safeError('Lyric timing is temporarily unavailable.', 409);
        if (!Number.isInteger(Number(body.confirmed_max_credits)) || Number(body.confirmed_max_credits) < credits) {
          return Response.json({ error: 'The price changed. Review the updated credit total before continuing.', credits_required: credits }, { status: 409 });
        }
        const reserved = await callRpc('reserve_paid_credits_v1', {
          p_user_id: user.id,
          p_operation: 'lyric_timing',
          p_estimated_credits: credits,
          p_max_reservation_credits: credits,
          p_pricing_policy_version: atCost ? AT_COST_POLICY : ALIGN_POLICY,
          p_idempotency_key: `lyric-timing:${idempotencyKey}`,
          p_ttl_seconds: 900,
        });
        const reservation = Array.isArray(reserved.data) ? reserved.data[0] : reserved.data;
        if (!reserved.ok || !reservation?.id) {
          const message = String(reserved?.data?.message || '');
          if (message.includes('INSUFFICIENT')) {
            return Response.json({ error: `Timing your lyrics costs ${credits} purchased credits. Buy credits to continue.`, code: 'insufficient_paid_credits', credits_required: credits }, { status: 402 });
          }
          return safeError('Could not reserve credits. Please try again.', 409);
        }
        let words;
        try {
          words = await transcribe(file, parsed.lines.map((l) => l.text).join('\n'));
        } catch (err) {
          await callRpc('release_reservation_v2', { p_reservation_id: reservation.id, p_reason: 'lyric_timing_failed' });
          console.error('lyric timing', err.message);
          return safeError('Your song could not be timed right now. You were not charged.', 502);
        }
        const lines = alignLyrics(parsed.lines, words, durationMs);
        const music = {
          song_id: song.id,
          duration_ms: durationMs,
          lines,
          cast: cleanCast(musicOf(project)?.cast, parsed.cast),
          heard_words: words.length,
          confirmed: false,
          timed_at: new Date().toISOString(),
        };
        const saved = await saveMusic(project, music);
        if (!saved.ok) {
          await callRpc('release_reservation_v2', { p_reservation_id: reservation.id, p_reason: 'lyric_timing_save_failed' });
          return safeError('The timing could not be saved. You were not charged.', 500);
        }
        const settled = await callRpc('settle_reservation_v2', { p_reservation_id: reservation.id, p_settled_credits: credits, p_generation_job_id: null });
        if (!settled.ok) console.error('lyric timing settle failed', reservation.id);
        return Response.json({ music, credits_charged: credits });
      });
    } catch (err) {
      console.error('lyric timing song', err.message);
      return safeError('Your song could not be read. Try uploading it again as MP3 or WAV.', 502);
    }
  }

  if (action === 'save') {
    const music = musicOf(project);
    if (!music?.lines?.length) return safeError('Time your lyrics first.', 409);
    const edits = Array.isArray(body.lines) ? body.lines : [];
    if (edits.length !== music.lines.length) return safeError('The lyric lines changed. Time the song again.', 409);
    const merged = music.lines.map((line, i) => ({
      ...line,
      start_ms: Number(edits[i]?.start_ms),
      end_ms: Number(edits[i]?.end_ms),
      vocalist: typeof edits[i]?.vocalist === 'string' ? edits[i].vocalist.slice(0, 40) : line.vocalist,
    }));
    if (merged.some((l) => !Number.isFinite(l.start_ms) || !Number.isFinite(l.end_ms))) return safeError('Every line needs a start and end time.', 400);
    const next = {
      ...music,
      lines: normalizeTimedLines(merged, music.duration_ms),
      cast: cleanCast(body.cast ?? music.cast, music.cast || []),
      confirmed: Boolean(body.confirmed),
    };
    const saved = await saveMusic(project, next);
    if (!saved.ok) return safeError('Timing could not be saved.', 500);
    return Response.json({ music: next });
  }

  if (action === 'build') {
    const music = musicOf(project);
    if (!music?.lines?.length || !music.confirmed) return safeError('Review and confirm the lyric timing first.', 409);
    const scenes = await selectRows('scenes', { project_id: `eq.${project.id}` }, 'id');
    if (scenes.length) {
      const takes = await selectRows('scene_versions', { scene_id: `in.(${scenes.map((s) => s.id).join(',')})`, limit: '1' }, 'id');
      if (takes.length && body.replace_takes !== true) {
        return Response.json({ error: 'Some scenes already have takes. Rebuilding replaces every scene and its takes.', code: 'has_takes' }, { status: 409 });
      }
    }
    const vi = project.visual_identity || {};
    const style = [vi.style, vi.style_notes].filter(Boolean).join(', ').slice(0, 300);
    const rows = timelineToScenes(buildTimeline(music.lines, music.duration_ms), { cast: music.cast || [], style, resolution: body.resolution });
    if (!rows.length) return safeError('No scenes could be built from this song.', 409);
    if (rows.length > 80) return safeError('This song needs more scenes than one project allows.', 409);
    if (scenes.length) {
      const removed = await deleteRows('scenes', { project_id: `eq.${project.id}` });
      if (removed?.ok === false) return safeError('Old scenes could not be cleared.', 500);
    }
    const inserted = await insertRows('scenes', rows.map((r) => ({ ...r, project_id: project.id })));
    if (!inserted.ok) return safeError('Scenes could not be created.', 500);
    await saveMusic(project, { ...music, built_at: new Date().toISOString(), scene_count: rows.length });
    return Response.json({ scenes: rows.length, lip_sync_scenes: rows.filter((r) => r.lip_sync).length });
  }

  return safeError('Unknown music action.', 400);
}
