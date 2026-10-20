// Automatic failover: when a model fails a job (and it isn't a content
// block or a busy signal, which have their own handling), the job is
// resubmitted at once to the next most reliable model that takes the same
// inputs. The customer is charged once, at the quoted price, only when a
// take is delivered; a failover never costs them more.
//
// Chosen from MUAPI's live reliability leaderboard (completed / submitted
// production jobs, 7 days, https://muapi.ai/rankings/video, checked
// 2026-10-20) and MUAPI's estimate-cost endpoint:
//   kling-v1-avatar-standard  sung scenes   7c/s   (our record 1/1; quality proven)
//   infinitetalk-image-to-video             8c/s   96.3% of 158
//   ltx-2.3-lipsync (<= 20 s audio)         ~3c/s  98.6% of 142
//   seedance-v1.5-pro-i2v-fast  motion      3.9c/s (1080p) 99.4% of 795
//   kling-v2.1-standard-i2v                 4.5c/s 97.4% of 374
//   pixverse-v6-i2v (720p)                  5.9c/s 87.5%
//   veed-lipsync  lip sync on a take        ~1c/s  98.3%
//   creatify-lipsync                        ~2.2c/s 97.2%
//   kling-v3.0-pro-motion-control           16c/s  (same family as std)

import { resolveInputMedia } from '../storage/media.js';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.ceil(Number(n) || lo)));
const imageOf = (i) => i.image_url || (Array.isArray(i.images_list) ? i.images_list[0] : null);
const aspectOf = (i) => (['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'].includes(i.aspect_ratio) ? i.aspect_ratio : '16:9');

const seedanceFast = (i) => ({
  prompt: String(i.prompt || '').slice(0, 2000),
  image_url: imageOf(i),
  duration: clamp(i.duration, 4, 12),
  resolution: i.resolution === '720p' ? '720p' : '1080p',
  aspect_ratio: aspectOf(i),
  generate_audio: false,
  camera_fixed: false,
});

/** primary model -> ordered fallbacks: { model, build(input), maxAudioSeconds? } */
export const FAILOVER_CHAINS = Object.freeze({
  'kling-v1-avatar-standard': [
    { model: 'infinitetalk-image-to-video', build: (i) => ({ prompt: i.prompt, image_url: imageOf(i), audio_url: i.audio_url, resolution: '720p' }) },
    { model: 'ltx-2.3-lipsync', maxAudioSeconds: 20, build: (i) => ({ prompt: i.prompt, image_url: imageOf(i), audio_url: i.audio_url, resolution: '720p' }) },
  ],
  'seedance-v1.5-pro-i2v-fast': [
    { model: 'kling-v2.1-standard-i2v', build: (i) => ({ prompt: String(i.prompt || '').slice(0, 2000), image_url: imageOf(i), duration: Number(i.duration) <= 5 ? 5 : 10, aspect_ratio: aspectOf(i) }) },
    { model: 'pixverse-v6-i2v', build: (i) => ({ prompt: i.prompt, images_list: [imageOf(i)], duration: clamp(i.duration, 1, 10), resolution: '720p', thinking_type: 'disabled', generate_audio_switch: false }) },
  ],
  'pixverse-v6-i2v': [
    { model: 'seedance-v1.5-pro-i2v-fast', build: seedanceFast },
  ],
  'seedance-2-omni-reference-no-video-fast': [
    { model: 'seedance-v1.5-pro-i2v-fast', build: seedanceFast },
  ],
  'kling-v3.0-std-motion-control': [
    { model: 'kling-v3.0-pro-motion-control', build: (i) => ({ ...i }) },
  ],
  'veed-lipsync': [
    { model: 'creatify-lipsync', build: (i) => ({ video_url: i.video_url, audio_url: i.audio_url }) },
  ],
  'volcengine-video-to-video-lip-sync': [
    { model: 'veed-lipsync', build: (i) => ({ video_url: i.video_url, audio_url: i.audio_url }) },
    { model: 'creatify-lipsync', build: (i) => ({ video_url: i.video_url, audio_url: i.audio_url }) },
  ],
});

// Longest a single model attempt may run before it counts as failed.
// Normal: stills under 3 min, takes 2-8 min. Busy waits are separate.
export const STUCK_AFTER_MS = 20 * 60 * 1000;

/** Whether the live attempt has been running far too long. */
export function attemptIsStuck(job, now = Date.now()) {
  const state = job?.output?.busy_retry;
  const started = Date.parse(state?.submitted_at || job?.updated_at || job?.created_at || '');
  return Number.isFinite(started) && now - started > STUCK_AFTER_MS;
}

/** The fallbacks still open for a job, in order. */
export function remainingFallbacks(state = {}) {
  const chain = FAILOVER_CHAINS[state.primary_model] || [];
  const start = Number(state.failover_index) || 0;
  const audio = Number(state.audio_seconds) || 0;
  return chain.slice(start).map((option, offset) => ({ ...option, index: start + offset + 1 }))
    .filter((option) => !option.maxAudioSeconds || !audio || audio <= option.maxAudioSeconds);
}

/**
 * Called after a non-busy, non-blocked failure. Submits the next fallback.
 * Returns { action: 'failed_over', model } or { action: 'none' }.
 */
export async function handleFailover({ job, base, apiKey, updateRows, insertRows = null, fetchImpl = fetch }) {
  const state = job?.output?.busy_retry;
  if (!state?.input || !state.primary_model) return { action: 'none' };
  const sourceInput = state.original_input || state.input;
  for (const option of remainingFallbacks(state)) {
    // Claim this step first so two open tabs can never submit it twice.
    const claimed = await updateRows(
      'generation_requests',
      { id: `eq.${job.id}`, status: 'eq.running', 'output->busy_retry->>failover_index': `eq.${Number(state.failover_index) || 0}` },
      { output: { busy_retry: { ...state, failover_index: option.index } } }
    );
    if (!claimed.ok || !Array.isArray(claimed.data) || claimed.data.length === 0) return { action: 'claimed_elsewhere' };
    state.failover_index = option.index;
    const input = option.build(sourceInput);
    let newId = null;
    try {
      const res = await fetchImpl(`${base}/api/v1/${option.model}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify(resolveInputMedia(input)),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) newId = body?.request_id || body?.id || body?.data?.request_id || null;
    } catch {
      newId = null;
    }
    if (insertRows) {
      Promise.resolve(insertRows('admin_metric_events', { event_type: 'generation_failover', operation: job.operation, model: option.model, user_id: job.user_id || null, status: newId ? 'submitted' : 'rejected', metadata: { from: state.endpoint, primary: state.primary_model, step: option.index } })).catch(() => {});
    }
    if (!newId) continue;
    await updateRows('generation_requests', { id: `eq.${job.id}` }, {
      output: {
        busy_retry: {
          ...state,
          original_input: sourceInput,
          endpoint: option.model,
          input,
          attempts: 0,
          next_at: null,
          current_request_id: newId,
          failover_index: option.index,
          failover_model: option.model,
          submitted_at: new Date().toISOString(),
        },
      },
    });
    return { action: 'failed_over', model: option.model };
  }
  return { action: 'none' };
}
