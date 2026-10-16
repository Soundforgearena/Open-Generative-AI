// Song lyrics -> timed lines -> a scene timeline that covers the whole song.
//
import { serializeShotDirection } from '../studio/studio-model.js';

// Pure functions only (no I/O) so they run on the server, in the browser and
// in tests. Times are integer milliseconds from the start of the song.

export const MAX_SCENE_MS = 10_000; // longest clip the video model makes
export const MIN_SCENE_MS = 1_500; // shorter gaps are folded into neighbours
/** Shortest sung shot the one-step singing model accepts (5 s of audio). */
export const MIN_SUNG_MS = 5_000;
/** Longest one-step sung shot (the model accepts up to 60 s; 15 s keeps cuts lively). */
export const MAX_SUNG_MS = 15_000;
const MAX_NUDGE_MS = 600; // a sung shot may borrow this much from a sung neighbour
const MIN_LEFTOVER_MS = 1_500; // b-roll shorter than this is absorbed
const PRE_ROLL_MS = 150; // mouth starts moving just before the first syllable
const POST_ROLL_MS = 250; // let the last syllable ring out

const STAGE_WORDS = /\b(beat|drop|switch|burst|instrumental|break|flow|speed|intro|outro|hook|verse|bridge|pre-?chorus|chorus|interlude|solo|fade|build|silence|pause|entry|ad-?lib|refrain|tag|section)\b/i;
// [Both] / [All] = every lead singer together, not another performer.
const BOTH_WORDS = /^(both|all|everyone|everybody|together|all singers|both singers)\b/i;
// [Ladies] / [Crowd] / [Choir] = backing vocals: heard, not lip-synced on camera.
const BACKING_WORDS = /\b(crowd|group|choir|ladies|girls|guys|men|women|backing|chorus|bgv|background|hype)\b/i;
export const BOTH = 'both';

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Lowercase, accent-free word tokens used for matching sung words. */
export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2019']/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isSectionHeading(line) {
  // "OPENING", "VERSE 2 — SPEED RAP", "FINAL HOOK": all caps, no lowercase.
  return /[A-Z]/.test(line) && !/[a-z]/.test(line) && line.length <= 60 && tokenize(line).length <= 6;
}

/**
 * Parse lyrics written with optional vocalist tags, e.g.
 *   [Afro-Canadian] / [ Jamaican | authentic cadence ] / [ Both — chant ]
 * Tags whose name is a stage note ([Beat Drop], [Flow Switch]) keep the
 * current vocalist. All-caps lines are section headings, not sung words.
 */
export function parseLyrics(raw) {
  const lines = [];
  const cast = new Map();
  let vocalist = null;
  let section = '';
  for (const rawLine of String(raw || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^[\u2E3B\u2014\u2013\-_=*~•·]+$/.test(line)) continue;
    const tag = line.match(/^\[(.*)\]$/);
    if (tag) {
      const head = tag[1].split(/[|—–:(]|\s-\s/)[0].trim();
      if (head && BOTH_WORDS.test(head)) {
        vocalist = BOTH;
      } else if (head && !STAGE_WORDS.test(head)) {
        const key = slug(head);
        if (key) {
          vocalist = key;
          if (!cast.has(key)) cast.set(key, { key, label: head.slice(0, 60), role: BACKING_WORDS.test(head) ? 'backing' : 'singer' });
        }
      }
      continue;
    }
    if (isSectionHeading(line)) { section = line.slice(0, 60); continue; }
    if (!tokenize(line).length) continue;
    lines.push({ index: lines.length, text: line.slice(0, 300), vocalist, section });
  }
  const singers = [...cast.values()].filter((c) => c.role === 'singer');
  const firstSinger = lines.find((l) => singers.some((c) => c.key === l.vocalist))?.vocalist || null;
  for (const l of lines) if (!l.vocalist) l.vocalist = firstSinger || 'lead';
  if (!singers.length || lines.some((l) => l.vocalist === 'lead')) {
    if (!cast.has('lead')) cast.set('lead', { key: 'lead', label: 'Lead artist', role: 'singer' });
  }
  return { lines, cast: [...cast.values()] };
}

/** Lead singers only (backing vocals and "Both" are not separate performers). */
export function singersOf(cast = []) {
  return cast.filter((c) => (c.role || 'singer') === 'singer');
}

/** True when a line should be lip-synced on camera. */
export function isSungOnCamera(vocalist, cast = []) {
  if (vocalist === BOTH) return true;
  const member = cast.find((c) => c.key === vocalist);
  return !member || (member.role || 'singer') === 'singer';
}

function editDistance(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function similarity(a, b) {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (!longest) return 0;
  return 1 - editDistance(a, b) / longest;
}

/**
 * Map the user's lyric lines onto transcribed word timestamps.
 * `words` = [{ word, start, end }] in seconds (Whisper word timestamps).
 * Uses a global sequence alignment so a misheard word never shifts the rest
 * of the song. Lines with no matched words are interpolated between their
 * neighbours. Every line gets start_ms/end_ms and a 0..1 confidence.
 */
function rawAlign(lines, words, durationMs) {
  const lyricTokens = [];
  lines.forEach((line, li) => tokenize(line.text).forEach((t) => lyricTokens.push({ t, li })));
  const heard = [];
  for (const w of words || []) {
    const tokens = tokenize(w.word);
    const start = Math.round(Number(w.start) * 1000);
    const end = Math.round(Number(w.end) * 1000);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    tokens.forEach((t) => heard.push({ t, start, end: Math.max(end, start + 1) }));
  }
  const n = lyricTokens.length;
  const m = heard.length;
  const matchAt = new Array(n).fill(-1);
  if (n && m) {
    const GAP = -0.4;
    const score = (i, j) => {
      const s = similarity(lyricTokens[i].t, heard[j].t);
      return s >= 0.99 ? 2 : s >= 0.6 ? 1 : -1;
    };
    // DP over (n+1)x(m+1) with a compact direction table.
    const dir = new Uint8Array((n + 1) * (m + 1));
    let prev = new Float64Array(m + 1);
    for (let j = 1; j <= m; j += 1) { prev[j] = prev[j - 1] + GAP * 0.25; dir[j] = 2; }
    for (let i = 1; i <= n; i += 1) {
      const cur = new Float64Array(m + 1);
      cur[0] = prev[0] + GAP;
      dir[i * (m + 1)] = 1;
      for (let j = 1; j <= m; j += 1) {
        const diag = prev[j - 1] + score(i - 1, j - 1);
        const up = prev[j] + GAP; // lyric word not heard
        const left = cur[j - 1] + GAP * 0.25; // extra heard word (ad-lib)
        let best = diag; let d = 0;
        if (up > best) { best = up; d = 1; }
        if (left > best) { best = left; d = 2; }
        cur[j] = best;
        dir[i * (m + 1) + j] = d;
      }
      prev = cur;
    }
    let i = n; let j = m;
    while (i > 0 && j > 0) {
      const d = dir[i * (m + 1) + j];
      if (d === 0) {
        if (similarity(lyricTokens[i - 1].t, heard[j - 1].t) >= 0.6) matchAt[i - 1] = j - 1;
        i -= 1; j -= 1;
      } else if (d === 1) i -= 1;
      else j -= 1;
    }
  }

  const total = Math.max(1, Number(durationMs) || (heard.length ? heard[heard.length - 1].end + 1000 : 1));
  const timed = lines.map((line) => ({ ...line, start_ms: null, end_ms: null, confidence: 0 }));
  lines.forEach((line, li) => {
    const idx = [];
    let count = 0;
    lyricTokens.forEach((tok, k) => { if (tok.li === li) { count += 1; if (matchAt[k] >= 0) idx.push(matchAt[k]); } });
    if (idx.length) {
      timed[li].start_ms = heard[Math.min(...idx)].start;
      timed[li].end_ms = heard[Math.max(...idx)].end;
      timed[li].confidence = Math.round((idx.length / Math.max(1, count)) * 100) / 100;
    }
  });
  return { timed, total };
}

/**
 * A line's match only counts as a timing anchor when enough of its words were
 * heard; one stray word ("now", "the") must not drag a line across the song.
 */
function isAnchor(line) {
  if (line.start_ms === null) return false;
  const words = tokenize(line.text).length;
  return line.confidence >= (words <= 2 ? 0.5 : 0.34);
}

/**
 * Pick the best-supported timing for every line across one or more listening
 * passes, keeping lines in song order (max total confidence, never going
 * backwards in time). Lines without a trustworthy anchor are re-placed
 * between their neighbours and flagged for review.
 */
function chooseAnchors(passes) {
  const L = passes[0].length;
  const cands = Array.from({ length: L }, (_, li) => passes.map((p) => p[li]).filter(isAnchor));
  // best[li][c] = best score of a chain ending with line li using candidate c.
  const best = []; const back = [];
  for (let li = 0; li < L; li += 1) {
    best[li] = []; back[li] = [];
    cands[li].forEach((c, ci) => {
      let score = c.confidence; let from = null;
      for (let lj = 0; lj < li; lj += 1) {
        cands[lj].forEach((d, di) => {
          if (d.end_ms - 300 <= c.start_ms && best[lj][di] + c.confidence > score) {
            score = best[lj][di] + c.confidence; from = [lj, di];
          }
        });
      }
      best[li][ci] = score; back[li][ci] = from;
    });
  }
  let end = null; let top = -1;
  best.forEach((row, li) => row.forEach((v, ci) => { if (v > top) { top = v; end = [li, ci]; } }));
  const chosen = new Array(L).fill(null);
  while (end) { const [li, ci] = end; chosen[li] = cands[li][ci]; end = back[li][ci]; }
  return chosen;
}

/** Time lyric lines from one or more lists of heard words. */
export function alignLyrics(lines, words, durationMs) {
  return alignFromPasses(lines, [words], durationMs);
}

export function alignFromPasses(lines, passes, durationMs) {
  const runs = passes.map((words) => rawAlign(lines, words, durationMs));
  const total = Math.max(...runs.map((r) => r.total));
  const chosen = chooseAnchors(runs.map((r) => r.timed));
  const timed = lines.map((line, li) => (chosen[li]
    ? { ...line, start_ms: chosen[li].start_ms, end_ms: chosen[li].end_ms, confidence: chosen[li].confidence }
    : { ...line, start_ms: null, end_ms: null, confidence: 0 }));

  // Lines nobody heard (chants, ad-libs buried in the mix) get a natural
  // sung length (~380 ms a word) instead of stretching across a whole gap.
  // After a matched line they follow it; at the very start they lead into the
  // first matched line. They are flagged (confidence 0) for review.
  const natural = (l) => Math.max(700, tokenize(l.text).length * 380);
  for (let li = 0; li < timed.length; li += 1) {
    if (timed[li].start_ms !== null) continue;
    let a = li; while (a < timed.length && timed[a].start_ms === null) a += 1;
    const before = li > 0 ? timed[li - 1].end_ms : null;
    const after = a < timed.length ? timed[a].start_ms : total;
    const run = timed.slice(li, a);
    const want = run.reduce((sum, l) => sum + natural(l) + 200, 0);
    const lo = before === null ? 0 : before;
    const span = Math.max(0, after - lo);
    const scale = want > span ? span / want : 1;
    let t = before === null ? Math.max(0, after - Math.min(span, want)) : lo + Math.min(200, span * 0.05);
    run.forEach((l) => {
      const len = Math.max(1, Math.round(natural(l) * scale));
      l.start_ms = Math.round(t); l.end_ms = Math.round(t + len); l.confidence = 0;
      t += len + 200 * scale;
    });
    li = a - 1;
  }
  return normalizeTimedLines(timed, total);
}

/** Clamp, order and de-overlap timed lines. Used after alignment and edits. */
export function normalizeTimedLines(lines, durationMs) {
  const total = Math.max(1, Math.round(Number(durationMs) || 0));
  const out = lines.map((l) => ({
    ...l,
    start_ms: Math.max(0, Math.min(total - 1, Math.round(Number(l.start_ms) || 0))),
    end_ms: Math.max(1, Math.min(total, Math.round(Number(l.end_ms) || 0))),
  }));
  for (let i = 0; i < out.length; i += 1) {
    if (i > 0 && out[i].start_ms < out[i - 1].end_ms) {
      // Overlap: meet in the middle so neither line loses its words.
      const mid = Math.round((out[i].start_ms + out[i - 1].end_ms) / 2);
      out[i - 1].end_ms = Math.max(out[i - 1].start_ms + 1, mid);
      out[i].start_ms = Math.max(out[i - 1].end_ms, Math.min(mid, out[i].end_ms - 1));
    }
    if (out[i].end_ms <= out[i].start_ms) out[i].end_ms = Math.min(total, out[i].start_ms + 400);
  }
  return out;
}

function chunks(start, end, maxMs) {
  const span = end - start;
  const parts = Math.max(1, Math.ceil(span / maxMs));
  const size = span / parts;
  const out = [];
  for (let k = 0; k < parts; k += 1) {
    out.push([Math.round(start + k * size), k === parts - 1 ? end : Math.round(start + (k + 1) * size)]);
  }
  return out;
}

/**
 * Turn timed lines into contiguous scenes from 0 to the end of the song.
 * Sung scenes (lip_sync=true) group consecutive lines by the same vocalist,
 * up to MAX_SCENE_MS. Instrumental gaps become their own scenes; gaps shorter
 * than MIN_SCENE_MS are folded into the neighbouring sung scene.
 */
export function buildTimeline(lines, durationMs, { maxMs = MAX_SCENE_MS, minMs = MIN_SCENE_MS, cast = [] } = {}) {
  const total = Math.round(Number(durationMs) || 0);
  if (!(total > 0)) return [];
  const groups = [];
  const backing = lines.filter((l) => !isSungOnCamera(l.vocalist, cast));
  for (const line of lines.filter((l) => isSungOnCamera(l.vocalist, cast))) {
    const last = groups[groups.length - 1];
    if (
      last && last.vocalist === line.vocalist &&
      line.start_ms - last.end_ms <= 1200 &&
      line.end_ms - last.start_ms <= maxMs - PRE_ROLL_MS - POST_ROLL_MS
    ) {
      last.end_ms = Math.max(last.end_ms, line.end_ms);
      last.lines.push(line);
    } else {
      groups.push({ vocalist: line.vocalist, start_ms: line.start_ms, end_ms: line.end_ms, section: line.section, lines: [line] });
    }
  }

  const scenes = [];
  const push = (start, end, extra) => {
    for (const [s, e] of chunks(start, end, maxMs)) if (e > s) scenes.push({ start_ms: s, end_ms: e, ...extra });
  };
  let cursor = 0;
  groups.forEach((g, gi) => {
    const next = groups[gi + 1];
    let gs = Math.max(cursor, g.start_ms - PRE_ROLL_MS);
    let ge = Math.min(total, g.end_ms + POST_ROLL_MS);
    if (next) ge = Math.min(ge, Math.max(gs + 1, next.start_ms - PRE_ROLL_MS));
    if (gs - cursor >= minMs) push(cursor, gs, { lip_sync: false, vocalist: null, lyric_text: '', section: g.section });
    else gs = cursor;
    push(gs, ge, { lip_sync: true, vocalist: g.vocalist, lyric_text: g.lines.map((l) => l.text).join(' / '), section: g.section });
    cursor = ge;
  });
  if (total - cursor >= minMs || !scenes.length) push(cursor, total, { lip_sync: false, vocalist: null, lyric_text: '', section: 'Outro' });
  else if (total > cursor) {
    const last = scenes[scenes.length - 1];
    if (total - last.start_ms <= maxMs) last.end_ms = total;
    else push(cursor, total, { lip_sync: false, vocalist: null, lyric_text: '', section: 'Outro' });
  }
  // Backing chants that land in an instrumental scene become its direction.
  for (const sc of scenes) {
    if (sc.lip_sync) continue;
    const heard = backing.filter((l) => l.start_ms < sc.end_ms && l.end_ms > sc.start_ms);
    if (heard.length) {
      sc.chant = heard.map((l) => l.text).join(' / ');
      sc.chant_by = heard[0].vocalist;
    }
  }
  // Absorb any sliver shorter than one second into its neighbour.
  for (let i = scenes.length - 1; i > 0; i -= 1) {
    if (scenes[i].end_ms - scenes[i].start_ms < 1000 && scenes[i].end_ms - scenes[i - 1].start_ms <= maxMs) {
      scenes[i - 1].end_ms = scenes[i].end_ms;
      if (scenes[i].lip_sync && !scenes[i - 1].lip_sync) Object.assign(scenes[i - 1], { lip_sync: true, vocalist: scenes[i].vocalist, lyric_text: scenes[i].lyric_text });
      scenes.splice(i, 1);
    }
  }
  return ensureSungMinimum(scenes, { maxMs });
}

/**
 * Sung shots are made in one step from the singer's still plus their slice of
 * the song, which needs at least 5 s of audio. Short sung scenes borrow time
 * from the neighbouring b-roll (the singer simply holds the moment before or
 * after the line); b-roll left too short is absorbed. Sung scenes that still
 * can't reach 5 s keep the two-step path (clip, then lip sync).
 */
export function ensureSungMinimum(scenes, { minSungMs = MIN_SUNG_MS, maxMs = MAX_SCENE_MS } = {}) {
  let out = scenes.map((s) => ({ ...s }));
  const len = (s) => s.end_ms - s.start_ms;
  for (let i = 0; i < out.length; i += 1) {
    const sc = out[i];
    if (!sc.lip_sync || len(sc) >= minSungMs) continue;
    const cap = Math.min(minSungMs, maxMs);
    // Borrow from the b-roll after first (the line rings out), then before.
    for (const dir of [1, -1]) {
      const j = i + dir;
      const nb = out[j];
      if (len(sc) >= cap || !nb || nb.lip_sync) continue;
      const need = cap - len(sc);
      const spare = len(nb);
      const take = spare - need < MIN_LEFTOVER_MS ? spare : need;
      if (dir === 1) { sc.end_ms += take; nb.start_ms += take; } else { sc.start_ms -= take; nb.end_ms -= take; }
    }
  }
  out = out.filter((s) => len(s) > 0);
  // Neighbouring sung scenes by the same singer merge when one is short
  // ("Both" lines merge into either singer's shot: both are singing).
  const sameVoice = (x, y) => x.vocalist === y.vocalist || x.vocalist === BOTH || y.vocalist === BOTH;
  for (let merged = true; merged;) {
    merged = false;
    for (let i = out.length - 2; i >= 0; i -= 1) {
      const x = out[i]; const y = out[i + 1];
      if (!x.lip_sync || !y.lip_sync || !sameVoice(x, y)) continue;
      if (len(x) >= minSungMs && len(y) >= minSungMs) continue;
      if (y.end_ms - x.start_ms > Math.max(maxMs, MAX_SUNG_MS)) continue;
      out.splice(i, 2, {
        ...x,
        end_ms: y.end_ms,
        vocalist: x.vocalist === BOTH ? y.vocalist : x.vocalist,
        lyric_text: [x.lyric_text, y.lyric_text].filter(Boolean).join(' / '),
      });
      merged = true;
    }
  }
  // Nearly long enough: borrow a breath (under 0.6 s) from a sung neighbour
  // that stays at 5 s or more.
  for (let i = 0; i < out.length; i += 1) {
    const sc = out[i];
    if (!sc.lip_sync || len(sc) >= minSungMs) continue;
    const need = minSungMs - len(sc);
    if (need > MAX_NUDGE_MS) continue;
    const next = out[i + 1]; const prev = out[i - 1];
    if (next && len(next) - need >= (next.lip_sync ? minSungMs : MIN_LEFTOVER_MS)) { sc.end_ms += need; next.start_ms += need; }
    else if (prev && len(prev) - need >= (prev.lip_sync ? minSungMs : MIN_LEFTOVER_MS)) { sc.start_ms -= need; prev.end_ms -= need; }
  }
  return out.filter((s) => len(s) > 0);
}

// Every music-video shot asks for photoreal people: natural skin, real
// micro-expressions and weight in movement, and none of the usual AI tells
// (shimmering textures, morphing faces, warped hands, waxy skin).
export const REALISM = 'photorealistic live-action footage shot on a cinema camera, real human performers with natural skin texture and pores, genuine micro-expressions, natural blinking and breathing, believable weight and timing in every movement, anatomically correct hands with five fingers, consistent faces from frame to frame, stable fine detail with no shimmering or flickering textures, no morphing, no warped limbs, no waxy or plastic skin, no extra people appearing, natural motion blur, true-to-life color grade, 24fps film look';

// Sung shots stay at eye level and face-on: lip sync needs one clear,
// frontal face. Variety comes from framing, lens and movement.
const SUNG_SHOTS = [
  { shot: 'Medium Close-Up', movement: 'Slow Push In', angle: 'Eye Level', lens: '85mm (portrait)' },
  { shot: 'Close-Up', movement: 'Handheld', angle: 'Eye Level', lens: '50mm (natural)' },
  { shot: 'Medium Shot', movement: 'Dolly Track', angle: 'Eye Level', lens: '35mm (cinematic)' },
  { shot: 'Close-Up', movement: 'Static', angle: 'Eye Level', lens: '85mm (portrait)' },
  { shot: 'Medium Close-Up', movement: 'Orbit', angle: 'Eye Level', lens: '50mm (natural)' },
];
const BROLL_SHOTS = [
  { shot: 'Wide Shot', movement: 'Dolly Track', angle: 'Eye Level', lens: '24mm (wide)' },
  { shot: 'Full Shot', movement: 'Handheld', angle: 'Low Angle', lens: '35mm (cinematic)' },
  { shot: 'Close-Up', movement: 'Static', angle: 'Low Angle', lens: '50mm (natural)' },
  { shot: 'Aerial', movement: 'Orbit', angle: "Bird's Eye", lens: '24mm (wide)' },
  { shot: 'Medium Shot', movement: 'Pan Right', angle: 'Eye Level', lens: '40mm (anamorphic)' },
];

// Crowds, dancers and backing groups are mixed by default: Black, white,
// South Asian and Latina women up front, alongside men of every background.
export const ENSEMBLE = 'a mixed, multicultural crowd of Black, white, South Asian and Latina women side by side with men of every background, the women front and centre';
export const BACKING_WOMEN = 'a group of Black, white, South Asian and Latina women';

const BROLL = [
  'wide shot of the crowd erupting into dance, camera gliding through',
  'dancers hitting the move in unison, low angle, motion blur',
  'detail shots of feet sliding and hands clapping on the beat',
  'overhead shot of the dance floor spinning like a carnival',
  'reaction shots of people trying to keep a straight face, then breaking into laughter',
];

/** Provider prompt for one scene. Sung scenes must show one clear face. */
export function scenePrompt(scene, { cast = [], style = '', index = 0 } = {}) {
  const look = style ? `, ${style}` : '';
  const describe = (m) => m?.description || m?.label || 'the lead artist';
  if (scene.lip_sync) {
    const performer = cast.find((c) => c.key === (scene.performer || scene.vocalist));
    const partner = scene.vocalist === BOTH ? singersOf(cast).find((c) => c.key !== performer?.key) : null;
    const who = partner
      ? `${describe(performer)} front and centre in sharp focus, with ${describe(partner)} beside and slightly behind, softly out of focus, both performing together`
      : describe(performer);
    return `${who} performing to camera, singing the words "${scene.lyric_text.slice(0, 180)}", face fully visible and evenly lit, looking straight into the lens, mouth clearly visible, no hands or microphone covering the mouth, one face in focus, relaxed natural jaw and lip movement${look}, ${REALISM}`;
  }
  const chanter = cast.find((c) => c.key === scene.chant_by);
  // A backing group with no description of its own ("Ladies", "Girls",
  // "Women") is shown as the mixed group, not left for the model to guess.
  const chantWho = chanter?.description
    || (chanter && /\b(ladies|girls|women|choir|backing)\b/i.test(chanter.label || '') ? BACKING_WOMEN : chanter?.label)
    || 'the crowd';
  const chant = scene.chant
    ? `, ${chantWho} chanting "${scene.chant.slice(0, 80)}" along with the beat, seen from a medium distance`
    : '';
  return `${BROLL[index % BROLL.length]}, ${ENSEMBLE}${chant}${scene.section ? `, ${scene.section.toLowerCase()} energy` : ''}${look}, no close-up talking faces, ${REALISM}`;
}

/** Scene rows ready to insert, numbered from 1. */
export function timelineToScenes(timeline, { cast = [], style = '', resolution = '720p', brollResolution = null } = {}) {
  const res = ['720p', '1080p'].includes(resolution) ? resolution : '720p';
  // B-roll may use a lower quality than the sung close-ups to save credits.
  const brollRes = ['720p', '1080p'].includes(brollResolution) ? brollResolution : res;
  const singers = singersOf(cast);
  let together = 0;
  return timeline.map((s, i) => {
    const seconds = (s.end_ms - s.start_ms) / 1000;
    // "Both" lines alternate which singer is lip-synced in close-up, since
    // lip sync drives one face per shot.
    const performer = s.lip_sync && s.vocalist === BOTH && singers.length
      ? singers[together++ % singers.length].key
      : s.vocalist;
    const member = cast.find((c) => c.key === performer);
    const who = s.vocalist === BOTH ? `Both (${member?.label || 'lead'})` : member?.label || 'Vocal';
    const scene = { ...s, performer };
    return {
      position: i + 1,
      title: s.lip_sync ? `${who} · ${s.lyric_text.split(' / ')[0].slice(0, 40)}` : `${s.section || 'Instrumental'} · ${s.chant ? 'Chant' : 'B-roll'}`,
      purpose: s.lip_sync ? `Lip-synced: “${s.lyric_text.slice(0, 400)}”` : s.chant ? `Backing chant (no lip sync): “${s.chant.slice(0, 300)}”` : 'Instrumental moment, cut to the beat.',
      duration_seconds: Math.min(600, Math.max(1, Math.ceil(seconds))),
      start_ms: s.start_ms,
      end_ms: s.end_ms,
      lyric_text: s.lip_sync ? s.lyric_text || null : s.chant || null,
      vocalist: s.lip_sync ? performer || null : null,
      lip_sync: Boolean(s.lip_sync),
      prompt: scenePrompt(scene, { cast, style, index: i }),
      shot_direction: serializeShotDirection({ ...(s.lip_sync ? SUNG_SHOTS : BROLL_SHOTS)[i % 5], fps: '24 fps', resolution: s.lip_sync ? res : brollRes, tags: [] }),
    };
  });
}
