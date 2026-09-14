const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeDirectorWorkflow,
  buildDirectorPlanPatch,
  generationGate,
} = require('../lib/director-workflow.js');

test('music-video workflow persistence keeps treatment/style/beat/continuity fields', () => {
  const workflow = normalizeDirectorWorkflow('music_video', {
    workflow: {
      treatment: 'Night drive concept',
      style_bible: 'Gold highlights and graphite blacks',
      beat_map: 'Verse, chorus, bridge',
      storyboard_notes: 'Five hero shots',
      continuity_metadata: 'Hero jacket remains wet after rain scene',
      approval_locked: true,
    },
  });
  const patch = buildDirectorPlanPatch({ lane: 'music_video', workflow, existingPlan: { creative_title: 'Midnight Signal' } });
  assert.equal(patch.lane, 'music_video');
  assert.equal(patch.workflow.approval_locked, true);
  assert.match(patch.workflow.style_bible, /graphite/i);
  assert.match(patch.workflow.beat_map, /chorus/i);
});

test('episode workflow persistence keeps screenplay/continuity/shot-plan fields', () => {
  const workflow = normalizeDirectorWorkflow('episode', {
    workflow: {
      premise: 'A station receives impossible messages from tomorrow',
      screenplay: 'INT. CONTROL ROOM - NIGHT',
      cast_world: 'A small lunar colony team',
      references: 'Moonbase schematics and EVA footage',
      runtime_minutes: 52,
      scene_breakdown: 'Cold open, investigation, reveal',
      continuity_bible: 'Helmet visor damage remains scene to scene',
      shot_plan: 'Wide to tight coverage on radio desk',
      greenlit: true,
    },
  });
  const patch = buildDirectorPlanPatch({ lane: 'episode', workflow, existingPlan: {} });
  assert.equal(patch.lane, 'episode');
  assert.equal(patch.workflow.greenlit, true);
  assert.equal(patch.workflow.runtime_minutes, 52);
  assert.match(patch.workflow.continuity_bible, /visor/i);
});

test('generation is blocked until explicit approval/greenlight is set', () => {
  const noApproval = generationGate({ lane: 'music_video', workflow: { approval_locked: false }, selectedSceneId: 'scene-1', videoOption: { model: 'x' } });
  assert.equal(noApproval.allowed, false);
  assert.match(noApproval.reason, /Approve and lock/i);

  const approved = generationGate({ lane: 'music_video', workflow: { approval_locked: true }, selectedSceneId: 'scene-1', videoOption: { model: 'x' } });
  assert.equal(approved.allowed, true);

  const noGreenlight = generationGate({ lane: 'episode', workflow: { greenlit: false }, selectedSceneId: 'scene-1', videoOption: { model: 'x' } });
  assert.equal(noGreenlight.allowed, false);
  assert.match(noGreenlight.reason, /Greenlight/i);
});

test('jobs start contract refuses dispatch without an existing reserved reservation', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/api/jobs/start/route.js'), 'utf8');
  assert.match(source, /if \(!reservationId \|\| !model \|\| !operation \|\| !input\)/);
  assert.match(source, /reservation\.status !== 'reserved'/);
  assert.match(source, /Reservation does not match this operation/);
  assert.match(source, /This never creates its own reservation/);
});

test('editor and lane-specific directors share the production workspace', () => {
  const editor = fs.readFileSync(path.join(process.cwd(), 'app/editor/page.js'), 'utf8');
  const music = fs.readFileSync(path.join(process.cwd(), 'app/music-video/director/page.js'), 'utf8');
  const episode = fs.readFileSync(path.join(process.cwd(), 'app/episode/director/page.js'), 'utf8');
  assert.match(editor, /DirectorWorkspace/);
  assert.match(music, /DirectorWorkspace/);
  assert.match(episode, /initialLane="episode"/);
});
