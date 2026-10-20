import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { textVerdict } from '../lib/music/likeness.js';

test('one invented word fails the still even when the overall answer says ok', () => {
  const v = textVerdict({ text_ok: true, text_issue: '', words: [{ text: 'RUM BAR', real: true }, { text: 'ONIES', real: false }, { text: 'CHICKEN', real: true }] });
  assert.equal(v.textOk, false);
  assert.equal(v.textIssue, '"ONIES"');
});

test('real words pass; no words passes; an overall fail still fails', () => {
  assert.deepEqual(textVerdict({ text_ok: true, text_issue: '', words: [{ text: 'JERK CHICKEN', real: true }, { text: 'OPEN', real: true }] }), { textOk: true, textIssue: '' });
  assert.equal(textVerdict({ text_ok: true, text_issue: '', words: [] }).textOk, true);
  assert.equal(textVerdict({ text_ok: false, text_issue: 'TENIS', words: [] }).textOk, false);
  assert.equal(textVerdict({ text_ok: true, words: [{ text: ' ', real: false }] }).textOk, true);
});

test('both still checks ask for every word, letter by letter', () => {
  const s = readFileSync(new URL('../lib/music/likeness.js', import.meta.url), 'utf8');
  assert.match(s, /copied letter by letter exactly as it appears/);
  assert.equal((s.match(/words: WORDS_SCHEMA/g) || []).length, 2);
  assert.equal((s.match(/textVerdict\(verdict\)/g) || []).length, 2);
});

test('stills wait up to 4 minutes for the provider before giving up', async () => {
  const { STILL_POLL_TIMEOUT_MS } = await import('../lib/music/likeness.js');
  assert.equal(STILL_POLL_TIMEOUT_MS, 240000);
  const s = readFileSync(new URL('../lib/music/likeness.js', import.meta.url), 'utf8');
  assert.match(s, /timeoutMs = STILL_POLL_TIMEOUT_MS/);
});
