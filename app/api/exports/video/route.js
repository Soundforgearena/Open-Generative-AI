import { createHash } from 'node:crypto';
import { canWrite } from '../../../../lib/studio/access';
import { resolveMedia, storageOn, PROVIDER_TTL_SECONDS } from '../../../../lib/storage/media.js';
import { cutFingerprint, saveFinalCut, shouldReplaceFinal } from '../../../../lib/storage/final-cut.js';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { isAtCostUser } from '../../../../lib/billing/at-cost.js';
import {
  guard,
  callRpc,
  selectOne,
  selectRows,
  createSignedDownloadUrl,
  insertRows,
  updateRows,
  safeError,
} from '../../../../lib/cinexvideo-server';
import { RenderBusyError, RenderDiskError, renderFinishedVideo, renderQueueState, safeFileName } from '../../../../lib/exports/render-video.js';
import { rateLimit } from '../../../../lib/rate-limit';
import { chooseTakes } from '../../../../lib/exports/choose-takes.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 900;

const BUCKET = 'cinexvideo-references';
const CLEAN_POLICY = 'clean_export_v1';
const REDOWNLOAD_DAYS = 7;

async function cleanPrice(lane, atCost) {
  if (atCost) return 0;
  const quote = await callRpc('customer_export_quote', {
    p_export_type: `${lane === 'episode' ? 'episode' : 'music_video'}_clean_export`,
    p_resolution: '1080p',
    p_format: 'mp4',
  });
  const row = Array.isArray(quote.data) ? quote.data[0] : quote.data;
  if (!quote.ok || !row?.approved) return null;
  return Number(row.credits) || 0;
}

/**
 * The finished video, downloaded straight to the user's device.
 *
 * Body: { project_id, clean?: boolean, quote_only?: boolean }
 * - Watermarked (default) is free: logo top-right, CINEXVIDEO bottom-right.
 * - Clean (no watermark) costs purchased credits, charged only after the
 *   render succeeds. Downloading the same cut again within 7 days is free.
 */
export async function POST(request) {
  const { user, admin, superAdmin, error } = await guard(request, { blockOnMaintenance: true });
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  const quoteOnly = Boolean(body.quote_only);
  const limited = rateLimit(`${quoteOnly ? 'export-quote' : 'export-render'}:${user.id}`, quoteOnly ? { limit: 60, windowMs: 60_000 } : { limit: 4, windowMs: 60_000 });
  if (limited) return limited;

  const project = body.project_id ? await selectOne('projects', { id: `eq.${body.project_id}` }, 'id,owner_id,title,lane,final_cut') : null;
  if (!canWrite(project, { user })) return safeError('Project not found.', 404);

  const scenes = await selectRows('scenes', { project_id: `eq.${project.id}`, order: 'position.asc' }, 'id,position,title,duration_seconds,start_ms,end_ms,lip_sync');
  if (!scenes.length) return safeError('Add and generate scenes before downloading your video.', 409);
  const versions = await selectRows(
    'scene_versions',
    { scene_id: `in.(${scenes.map((s) => s.id).join(',')})`, status: 'eq.completed' },
    'id,scene_id,version,output_url,approved,kind'
  );
  const { takes, missing, unsynced } = chooseTakes(scenes, versions);

  const clean = Boolean(body.clean);
  const atCost = isAtCostUser({ superAdmin });
  const price = clean ? await cleanPrice(project.lane, atCost) : 0;
  if (price === null) return safeError('Watermark removal is temporarily unavailable.', 409);

  const cutKey = createHash('sha256')
    .update([user.id, project.id, 'clean', ...takes.map((t) => t.version_id)].join('|'))
    .digest('hex')
    .slice(0, 40);
  const idempotencyKey = `clean-export:${cutKey}`;
  let alreadyPaid = false;
  if (clean && price > 0) {
    const since = new Date(Date.now() - REDOWNLOAD_DAYS * 86400_000).toISOString();
    const prior = await selectOne(
      'credit_reservations',
      { user_id: `eq.${user.id}`, idempotency_key: `eq.${idempotencyKey}`, status: 'in.(settled,consumed)', created_at: `gte.${since}` },
      'id'
    );
    alreadyPaid = Boolean(prior);
  }
  const credits = alreadyPaid ? 0 : price;

  if (quoteOnly) {
    let paidAvailable = null;
    if (clean && credits > 0) {
      const paid = await callRpc('paid_credits_available', { p_user_id: user.id });
      paidAvailable = paid.ok ? Number(paid.data) || 0 : null;
    }
    return Response.json({
      ready: missing.length === 0,
      missing,
      unsynced,
      scenes: scenes.length,
      seconds: takes.reduce((sum, t) => sum + t.duration, 0),
      clean,
      credits_required: credits,
      clean_price: price,
      already_paid: alreadyPaid,
      paid_credits_available: paidAvailable,
      at_cost: atCost,
      queue: renderQueueState(),
    });
  }

  if (missing.length) {
    return Response.json({ error: `Finish every scene first. Still needs a take: ${missing.join(', ')}.`, missing }, { status: 409 });
  }
  const queue = renderQueueState();
  if (queue.queued >= queue.queueLimit) {
    return Response.json({ error: 'Lots of people are rendering right now. Please try again in a minute.' }, { status: 503, headers: { 'Retry-After': '60' } });
  }

  // Reserve purchased credits up front so nobody renders a clean cut they
  // can't pay for; nothing is charged unless the render succeeds.
  let reservation = null;
  if (clean && credits > 0) {
    const reserved = await callRpc('reserve_paid_credits_v1', {
      p_user_id: user.id,
      p_operation: 'export_clean',
      p_estimated_credits: credits,
      p_max_reservation_credits: credits,
      p_pricing_policy_version: CLEAN_POLICY,
      p_idempotency_key: idempotencyKey,
      p_ttl_seconds: 1800,
    });
    reservation = Array.isArray(reserved.data) ? reserved.data[0] : reserved.data;
    if (!reserved.ok || !reservation?.id) {
      const message = String(reserved?.data?.message || '');
      if (message.includes('INSUFFICIENT')) {
        return Response.json(
          { error: `Removing the watermark costs ${credits} purchased credits ($${(credits / 100).toFixed(2)}). Buy credits to continue, or download the free watermarked version.`, code: 'insufficient_paid_credits', credits_required: credits },
          { status: 402 }
        );
      }
      if (message.includes('IDEMPOTENCY_KEY_CONFLICT')) return safeError('This export is already being prepared. Please wait for it to finish.', 409);
      return safeError('Could not reserve credits for watermark removal. Please try again.', 409);
    }
  }

  const audio = await selectRows('project_assets', { project_id: `eq.${project.id}`, kind: 'eq.audio', order: 'created_at.desc', limit: '1' }, 'storage_path');
  const soundtrackUrl = audio[0]?.storage_path ? await createSignedDownloadUrl(BUCKET, audio[0].storage_path, 3600) : null;

  let rendered;
  try {
    // Takes kept in our storage are read through short-lived signed links.
    const readable = takes.map((t) => ({ ...t, url: resolveMedia(t.url, { expiresIn: PROVIDER_TTL_SECONDS }) }));
    rendered = await renderFinishedVideo({ takes: readable, soundtrackUrl, watermark: !clean });
  } catch (err) {
    if (reservation) {
      const released = await callRpc('release_reservation_v2', { p_reservation_id: reservation.id, p_reason: 'export_failed' });
      if (!released.ok) console.error('export release failed', reservation.id);
    }
    if (err instanceof RenderBusyError || err instanceof RenderDiskError) {
      return Response.json({ error: 'Lots of people are rendering right now. Please try again in a minute.' }, { status: 503, headers: { 'Retry-After': '60' } });
    }
    console.error('export render failed', err.message);
    return safeError(
      /expired|fetch failed|no playable/.test(err.message)
        ? 'One of your takes could not be read. Regenerate that scene and try again. You were not charged.'
        : 'Your video could not be rendered. You were not charged. Please try again.',
      502
    );
  }

  if (reservation) {
    const settled = await callRpc('settle_reservation_v2', { p_reservation_id: reservation.id, p_settled_credits: credits, p_generation_job_id: null });
    if (!settled.ok) console.error('export settle failed', reservation.id);
  }
  await updateRows('projects', { id: `eq.${project.id}` }, { status: 'delivered' });

  // Keep this video as the project's Final cut (one file per project, replaced
  // by the next download) while it streams to the user.
  const cut = cutFingerprint(takes);
  const saving = storageOn() && shouldReplaceFinal(project.final_cut, { clean, cut })
    ? saveFinalCut({ file: rendered.file, size: rendered.size, ownerId: project.owner_id, projectId: project.id, clean, cut, seconds: rendered.duration, width: rendered.width, height: rendered.height })
      .then(async (saved) => {
        if (!saved.ok) { console.warn('final cut not saved', project.id, saved.reason, saved.status || ''); return; }
        await updateRows('projects', { id: `eq.${project.id}` }, { final_cut: saved.record });
        await insertRows('media_objects', {
          object_key: saved.key, owner_id: project.owner_id, project_id: project.id, kind: 'final',
          size_bytes: saved.record.bytes, content_type: 'video/mp4', sha256: saved.sha256,
        }, { upsert: true });
      })
      .catch((err) => console.error('final cut save failed', project.id, err?.message))
    : Promise.resolve();

  // Delete the rendered file once the download has ended (finished, failed or
  // cancelled) and the Final cut copy is done.
  const stream = createReadStream(rendered.file);
  let streamDone = false;
  const streamEnded = new Promise((resolve) => {
    const end = () => { if (!streamDone) { streamDone = true; resolve(); } };
    stream.on('close', end);
    stream.on('error', end);
  });
  Promise.all([streamEnded, saving]).finally(() => rendered.cleanup());
  const name = safeFileName(`${project.title || 'CineXVideo'}${clean ? '' : ' - CineXVideo'}`);
  return new Response(Readable.toWeb(stream), {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(rendered.size),
      'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'private, no-store',
      'X-Credits-Charged': String(credits),
      'X-Watermarked': clean ? 'false' : 'true',
    },
  });
}
