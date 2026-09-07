const test = require('node:test');
const assert = require('node:assert');
const {
  DIRECTOR_PERSONA,
  DIRECTOR_ACTION_BRIEFS,
  actionRequiresExistingText,
  isDirectorAction,
} = require('../lib/director-actions.js');
const { generateDirectorSuggestion } = require('../lib/ai-director-writing.js');
const { buildAppliedValue } = require('../lib/director-apply.js');

test('the Director can draft into an empty field', () => {
  // The whole point of the change: these actions must not require the writer
  // to produce text before they can get any help.
  assert.equal(actionRequiresExistingText('draftFromScratch'), false);
  assert.equal(actionRequiresExistingText('generateIdeaDirections'), false);
  assert.equal(actionRequiresExistingText('applyDirectorInstruction'), false);
});

test('actions that genuinely need prose still require it', () => {
  // Asking to "tighten" or "improve pacing" on an empty box is meaningless, so
  // those keep their guard rather than sending the model nothing to work on.
  assert.equal(actionRequiresExistingText('tightenScene'), true);
  assert.equal(actionRequiresExistingText('improvePacing'), true);
  assert.equal(actionRequiresExistingText('improveDialogue'), true);
});

test('draftFromScratch is a real, registered action', () => {
  assert.ok(isDirectorAction('draftFromScratch'));
  assert.match(DIRECTOR_ACTION_BRIEFS.draftFromScratch, /empty/i);
});

test('the persona covers every craft the Director is meant to embody', () => {
  for (const craft of [
    'movie director',
    'music-video director',
    'novelist',
    'screenwriter',
    'storyteller',
    'cinematographer',
  ]) {
    assert.ok(DIRECTOR_PERSONA.includes(craft), `persona is missing ${craft}`);
  }
});

test('the persona keeps the writer in control', () => {
  assert.match(DIRECTOR_PERSONA, /write it themselves/i);
});

test('the demo Director produces a usable draft for an empty field', () => {
  const result = generateDirectorSuggestion('draftFromScratch', {
    value: '',
    fieldLabel: 'scene 1 visual prompt',
  });
  assert.ok(result.suggestion.trim().length > 40);
  assert.match(result.whatChanged, /scene 1 visual prompt/);
});

test('applying a draft to an empty field yields exactly the draft', () => {
  // No leading blank lines, whichever apply mode the writer picks.
  assert.equal(buildAppliedValue('replace', '', 'A lone figure.'), 'A lone figure.');
  assert.equal(buildAppliedValue('insert', '', 'A lone figure.'), 'A lone figure.');
});

test('applying a draft never silently discards existing writing', () => {
  const existing = 'My own opening line.';
  assert.equal(
    buildAppliedValue('insert', existing, 'Director draft.'),
    'My own opening line.\n\nDirector draft.'
  );
});
