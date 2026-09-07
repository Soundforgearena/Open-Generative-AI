const test = require('node:test');
const assert = require('node:assert/strict');
const { validateContinuity } = require('../lib/continuity/continuity-validator.js');
const { compileContinuityPacket } = require('../lib/continuity/continuity-packet.js');
const { createContinuityBible } = require('../lib/continuity/continuity-bible.js');

test('continuity validator detects identity, lighting, overlap, and lip-sync issues', () => {
  const issues = validateContinuity({ bible: createContinuityBible({ characters: [{ id: 'hero', identityLock: false }] }), projectId: 'p', storyboard: [
    { id: 'a', type: 'performance', startSeconds: 0, endSeconds: 5, lipSyncMode: 'eligible', continuity: { entryState: {}, exitState: { lighting: 'day' }, characterStates: [{ characterId: 'hero' }] } },
    { id: 'b', type: 'performance', startSeconds: 4, endSeconds: 8, lyricConfirmationState: 'draft', lipSyncMode: 'eligible', continuity: { entryState: { lighting: 'night' }, exitState: {} } },
  ] });
  assert.ok(issues.some((issue) => issue.category === 'Identity'));
  assert.ok(issues.some((issue) => issue.category === 'Lighting'));
  assert.ok(issues.some((issue) => issue.category === 'Timeline'));
  assert.ok(issues.some((issue) => issue.category === 'Lyrics/lip sync'));
});

test('continuity packet contains locks, handoff, references, and shot prompt', () => {
  const packet = compileContinuityPacket({ bible: createContinuityBible(), project: { id: 'p' }, previousShot: { continuity: { exitState: { lighting: 'gold' } } }, nextShot: { continuity: { entryState: { lighting: 'gold' }, requiredReferences: ['hero'] }, lipSyncMode: 'none' }, shotPrompt: 'A wide performance shot' });
  assert.equal(packet.projectId, 'p');
  assert.equal(packet.shotPrompt, 'A wide performance shot');
  assert.deepEqual(packet.previousExitState, { lighting: 'gold' });
  assert.deepEqual(packet.approvedReferenceIds, ['hero']);
});
