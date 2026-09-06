const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('demo Director returns structured local suggestions for writing actions', async () => {
  const source = require('../lib/ai-director-writing.js');
  const result = source.generateIdeaDirections({ value: 'A pilot hears a voice from an empty planet.' });
  assert.equal(typeof result.title, 'string');
  assert.ok(result.suggestion.length > 0);
  assert.ok(result.whatChanged.length > 0);
  assert.ok(Array.isArray(result.followUpPrompts));
});

test('Director instruction returns safe generic style guidance', () => {
  const source = require('../lib/ai-director-writing.js');
  const result = source.applyDirectorInstruction({ value: 'A quiet scene.' }, 'Write this in the style of a living filmmaker');
  assert.match(result.suggestion, /high-level traits/i);
  assert.match(result.suggestion, /copying a living creator/i);
});

test('all core Director actions return non-empty structured drafts', () => {
  const source = require('../lib/ai-director-writing.js');
  const context = { value: 'A character faces a difficult choice.', style: 'Cinematic', duration: 30 };
  for (const action of ['expandStory', 'buildStoryArc', 'improvePacing', 'raiseStakes', 'createCharacter', 'suggestEnding', 'improveDialogue', 'writeNextScene', 'tightenScene', 'createVisualDirection', 'improveScenePurpose']) {
    const result = source[action](context);
    assert.ok(result.suggestion.length > 0, action);
    assert.ok(result.craftNote.length > 0, action);
  }
});

test('required writing surfaces include the reusable Director button', () => {
  const files = [
    'components/DemoProjectBuilder.js',
    'app/create/review/page.js',
    'app/create/director/page.js',
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    assert.match(source, /AskAiDirectorButton/);
  }
});

test('demo writing surfaces contain no protected API calls', () => {
  const files = ['components/AiDirectorAssistant.js', 'lib/ai-director-writing.js'];
  for (const file of files) {
    const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    assert.doesNotMatch(source, /\/api\/(director|generate|projects|scenes|billing|uploads|exports)/);
    assert.doesNotMatch(source, /fetch\(/);
  }
});

test('writing window integration is pending-only and keyboard-aware', () => {
  const writingWindow = fs.readFileSync(path.join(process.cwd(), 'components/AiDirectorWritingWindow.js'), 'utf8');
  const assistant = fs.readFileSync(path.join(process.cwd(), 'components/AiDirectorAssistant.js'), 'utf8');
  assert.match(writingWindow, /if \(!isOpen \|\| !isGenerating\) return null/);
  assert.match(writingWindow, /role="dialog"/);
  assert.match(writingWindow, /aria-modal="true"/);
  assert.match(writingWindow, /event\.key === 'Escape'/);
  assert.match(writingWindow, /ai-director-fairy-writing-room\.png/);
  assert.match(assistant, /AiDirectorWritingWindow/);
  assert.match(assistant, /setIsWriting\(true\)/);
});
