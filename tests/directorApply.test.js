const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAppliedValue } = require('../lib/director-apply.js');

const STORY = 'A courier has thirty seconds to choose.';
const DRAFT = 'With 30 seconds on a stolen countdown, a courier must choose:\nsave a stranger or save himself.';

test('Replace field swaps the story text for the Director draft', () => {
  assert.equal(buildAppliedValue('replace', STORY, DRAFT), DRAFT);
});

test('Replace field trims stray whitespace around the draft', () => {
  assert.equal(buildAppliedValue('replace', STORY, `\n\n  ${DRAFT}  \n`), DRAFT);
});

test('Replace field works when the field started empty', () => {
  assert.equal(buildAppliedValue('replace', '', DRAFT), DRAFT);
});

test('Insert below keeps the original text and appends the draft', () => {
  const next = buildAppliedValue('insert', STORY, DRAFT);
  assert.ok(next.startsWith(STORY), 'original text must be preserved');
  assert.ok(next.endsWith(DRAFT), 'draft must be appended');
  assert.equal(next, `${STORY}\n\n${DRAFT}`);
});

test('Insert below does not leave blank lines when the field was empty', () => {
  assert.equal(buildAppliedValue('insert', '', DRAFT), DRAFT);
  assert.equal(buildAppliedValue('insert', '   \n\n', DRAFT), DRAFT);
});

test('applying nothing is refused instead of wiping the field', () => {
  assert.equal(buildAppliedValue('replace', STORY, ''), null);
  assert.equal(buildAppliedValue('replace', STORY, '   '), null);
  assert.equal(buildAppliedValue('replace', STORY, undefined), null);
  assert.equal(buildAppliedValue('insert', STORY, null), null);
});

test('an unknown apply mode is refused', () => {
  assert.equal(buildAppliedValue('append', STORY, DRAFT), null);
});
