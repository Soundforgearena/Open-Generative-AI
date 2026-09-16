import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildSceneGenerationPayload,
  createGenerationAttempt,
  generationGate,
  invalidateDirectorWorkflow,
  isMissingAudioSyncColumnResult,
  mapProjectForWorkspace,
  mapSceneForWorkspace,
  preservePendingGeneration,
  scenePatchTouchesGeneration,
  validateReservationStartPayload,
  withStartedGeneration,
} from '../lib/director-workflow.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('scene edits invalidate the lane gate for every generation-relevant field', () => {
  const scene = {
    title: 'Opening',
    purpose: 'Hook',
    prompt: 'Neon rain',
    shot_direction: '50mm push-in',
    duration_seconds: 8,
    continuity_locked: true,
    audio_sync: 'Hit the snare on the cut.',
  };

  for (const patch of [
    { title: 'Opening revised' },
    { purpose: 'Bigger hook' },
    { prompt: 'Storm-lit alley' },
    { shot_direction: '35mm handheld' },
    { duration_seconds: 10 },
    { continuity_locked: false },
    { audio_sync: 'Delay the lyric reveal by two beats.' },
  ]) {
    assert.equal(scenePatchTouchesGeneration(scene, patch), true);
  }

  assert.deepEqual(
    invalidateDirectorWorkflow({
      lane: 'music_video',
      workflow: { approval_locked: true, greenlit: false },
      now: '2026-09-16T19:20:00.000Z',
    }),
    {
      invalidated: true,
      workflow: {
        lane: 'music_video',
        approval_locked: false,
        greenlit: false,
        approved_at: null,
        invalidated_at: '2026-09-16T19:20:00.000Z',
        updated_at: '2026-09-16T19:20:00.000Z',
      },
    }
  );

  assert.equal(
    invalidateDirectorWorkflow({
      lane: 'episode',
      workflow: { approval_locked: false, greenlit: true },
    }).workflow.greenlit,
    false
  );
});

test('generation attempts resume polling instead of creating a second paid dispatch', () => {
  const created = createGenerationAttempt({
    pendingGeneration: null,
    sceneId: 'scene-1',
    createIdempotencyKey: () => 'idem-1',
  });
  assert.equal(created.mode, 'start');
  assert.equal(created.attempt.idempotencyKey, 'idem-1');

  const started = withStartedGeneration(created.attempt, { request_id: 'req-1' });
  const recoverable = preservePendingGeneration(started, {
    message: 'Generation status is temporarily unavailable.',
    recoverable: true,
    requestId: 'req-1',
  });
  assert.equal(recoverable.requestId, 'req-1');

  const resumed = createGenerationAttempt({
    pendingGeneration: recoverable,
    sceneId: 'scene-1',
    createIdempotencyKey: () => 'idem-2',
  });
  assert.equal(resumed.mode, 'resume');
  assert.equal(resumed.attempt.idempotencyKey, 'idem-1');
  assert.equal(resumed.attempt.requestId, 'req-1');
});

test('dispatch gate is enforced lane by lane', () => {
  assert.equal(
    generationGate({
      lane: 'music_video',
      workflow: { approval_locked: false },
      hasScene: true,
    }).allowed,
    false
  );
  assert.equal(
    generationGate({
      lane: 'episode',
      workflow: { greenlit: false },
      hasScene: true,
    }).allowed,
    false
  );
  assert.equal(
    generationGate({
      lane: 'episode',
      workflow: { greenlit: true },
      hasScene: true,
    }).allowed,
    true
  );
});

test('workspace mapping prefers the newest completed take and falls back only when it has no preview', () => {
  const newestReady = mapSceneForWorkspace({
    id: 'scene-1',
    title: 'Opening',
    versions: [
      { version: 3, status: 'completed', approved: false, output_url: 'https://cdn.example/new.mp4' },
      { version: 2, status: 'completed', approved: true, output_url: 'https://cdn.example/approved.mp4' },
    ],
  });
  assert.equal(newestReady.preview_output_url, 'https://cdn.example/new.mp4');

  const fallbackApproved = mapSceneForWorkspace({
    id: 'scene-1',
    title: 'Opening',
    versions: [
      { version: 4, status: 'completed', approved: false, output_url: '' },
      { version: 3, status: 'completed', approved: true, output_url: 'https://cdn.example/approved.mp4' },
    ],
  });
  assert.equal(fallbackApproved.preview_output_url, 'https://cdn.example/approved.mp4');
});

test('take review payload exposes versions newest first and generation payload keeps audio sync separate from purpose', () => {
  const mapped = mapProjectForWorkspace({
    project: {
      id: 'project-1',
      lane: 'music_video',
      title: 'Night Signal',
      logline: 'Late-night transmission.',
      visual_identity: { aspect_ratio: '16:9', style: 'Cinematic' },
      director_plan: { workflow: { approval_locked: true } },
    },
    scenes: [
      {
        id: 'scene-1',
        position: 1,
        title: 'Opening',
        purpose: 'Set the hook',
        prompt: 'A neon skyline',
        shot_direction: '35mm glide',
        audio_sync: 'Cut on the downbeat.',
        duration_seconds: 8,
        continuity_locked: true,
        versions: [
          { version: 5, status: 'completed', approved: false, output_url: 'https://cdn.example/v5.mp4' },
          { version: 4, status: 'completed', approved: true, output_url: 'https://cdn.example/v4.mp4' },
        ],
      },
    ],
  });

  assert.deepEqual(
    mapped.scenes[0].versions.map((version) => version.version),
    [5, 4]
  );

  const payload = buildSceneGenerationPayload({
    project: mapped,
    scene: mapped.scenes[0],
    option: { model: 'pixverse-v6', operation: 'video', max_duration_seconds: 10 },
  });
  assert.match(payload.input.prompt, /Story purpose: Set the hook/);
  assert.match(payload.input.prompt, /Audio sync: Cut on the downbeat\./);
});

test('audio sync migration errors are detected safely and reservation-backed starts reject missing reservations', () => {
  assert.equal(
    isMissingAudioSyncColumnResult({
      data: {
        code: 'PGRST204',
        message: "Could not find the 'audio_sync' column of 'scenes' in the schema cache",
      },
    }),
    true
  );
  assert.equal(validateReservationStartPayload({ model: 'pixverse-v6', operation: 'video', input: {} }), 'Job request is incomplete.');
  assert.equal(validateReservationStartPayload({ reservation_id: 'r1', model: 'pixverse-v6', operation: 'video', input: {} }), '');
});

test('director routes mount the shared workspace with loading fallbacks', async () => {
  const editor = await read('app/editor/page.js');
  const musicDirector = await read('app/music-video/director/page.js');
  const episodeDirector = await read('app/create/director/page.js');

  for (const route of [editor, musicDirector, episodeDirector]) {
    assert.match(route, /DirectorWorkspace/);
    assert.match(route, /Suspense/);
    assert.match(route, /Loading .*Director workspace|Loading .*director workspace/);
  }
});
