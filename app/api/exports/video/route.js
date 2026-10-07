import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { isAtCostUser } from '../../../../lib/billing/at-cost.js';
import {
  guard,
  callRpc,
  selectOne,
  selectRows,
  createSignedDownloadUrl,
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

  const project = body.project_id ? await selectOne('projects', { id: `eq.${body.project_id}` }, 'id,owner_id,title,lane') : null;
  if (!project || (project.owner_id !== user.id && !admin)) return safeError('Project not found.', 404);

  const scenes = await selectRows('scenes', { project_id: `eq.${project.id}`, order: 'position.asc' }, 'id,position,title,duration_seconds');
  if (!scenes.length) return safeError('Add and generate scenes before downloading your video.', 409);
  const versions = await selectRows(
    'scene_versions',
    { scene_id: `in.(${scenes.map((s) => s.id).join(',')})`, status: 'eq.completed' },
    'id,scene_id,version,output_url,approved'
  );
  const { takes, missing } = chooseTakes(scenes, versions);

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
    rendered = await renderFinishedVideo({ takes, soundtrackUrl, watermark: !clean });
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
        ? 'One of your takes is no longer available from the video provider. Regenerate that scene and try again. You were not charged.'
        : 'Your video could not be rendered. You were not charged. Please try again.',
      502
    );
  }

  if (reservation) {
    const settled = await callRpc('settle_reservation_v2', { p_reservation_id: reservation.id, p_settled_credits: credits, p_generation_job_id: null });
    if (!settled.ok) console.error('export settle failed', reservation.id);
  }
  await updateRows('projects', { id: `eq.${project.id}` }, { status: 'delivered' });

  const stream = createReadStream(rendered.file);
  // Delete the finished file the moment the download ends, fails or is cancelled.
  stream.on('close', () => rendered.cleanup());
  stream.on('error', () => rendered.cleanup());
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
