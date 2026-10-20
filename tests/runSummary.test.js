import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runSummary } from '../lib/studio/run-summary.js';

test('only scene blocked: no "0 stills ready", no "review the rest"', () => {
  const m = runSummary({ kind: 'still', made: 0, blocked: 1 });
  assert.equal(m, "This scene needs a change to fit our content policy, so it wasn't made and nothing was charged. A safe version is waiting for you to review.");
  assert.ok(!/0 still|the rest/.test(m));
});

test('mixed runs read naturally', () => {
  assert.equal(runSummary({ kind: 'still', made: 2, blocked: 1 }), "2 stills ready. One scene needs a change to fit our content policy, so it wasn't made and nothing was charged. A safe version is waiting for you to review. Check the face and framing, then approve before animating.");
  assert.equal(runSummary({ kind: 'still', made: 1 }), 'Still ready. Check the face and framing, then approve before animating.');
  assert.equal(runSummary({ kind: 'still', blocked: 3 }), "3 scenes need a change to fit our content policy, so they weren't made and nothing was charged. Safe versions are waiting for you to review.");
  assert.equal(runSummary({ kind: 'still', failed: 1 }), "1 scene couldn't be made this time. Your credits for it were returned; try it again.");
  assert.equal(runSummary({ kind: 'take', made: 1, failed: 2 }), "New take ready. 2 scenes couldn't be finished this time. Your credits for them were returned; try them again. Review it in the scene.");
  assert.equal(runSummary({ kind: 'take', made: 3 }), '3 new takes ready. Review them in the scene.');
});

test('the Studio uses the summary for stills and takes', () => {
  const s = readFileSync(new URL('../components/studio/Studio.js', import.meta.url), 'utf8');
  assert.match(s, /setToast\(runSummary\(\{ kind: 'still', made, blocked, failed \}\)\)/);
  assert.match(s, /setToast\(runSummary\(\{ kind: 'take', made, blocked, failed \}\)\)/);
  assert.ok(!/not made\. Nothing was charged for those/.test(s));
});
