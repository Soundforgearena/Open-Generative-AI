import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rulerMarks } from '../lib/studio/studio-model.js';

const studio = readFileSync(new URL('../components/studio/Studio.js', import.meta.url), 'utf8');

test('free download never depends on the paid quote', () => {
  assert.match(studio, /Promise\.allSettled\(\[quoteFinishedVideo\(project\.id, false\), quoteFinishedVideo\(project\.id, true\)\]\)/);
  assert.ok(!/Promise\.all\(\[quoteFinishedVideo/.test(studio));
});

test('Escape closes open windows', () => {
  const i = studio.indexOf("if (e.key === 'Escape') {");
  const guard = studio.indexOf("if (loadState !== 'ready' || genDialog || deleteDialog || exportState.open) return;");
  assert.ok(i > 0 && i < guard);
});

test('timeline labels never overlap', () => {
  const offsets = [0, 5, 10, 48, 49, 100, 152].map((start, k) => ({ id: String(k), start }));
  const marks = rulerMarks(offsets, 155, 1300);
  const xs = marks.map((o) => (o.start / 155) * 1300);
  for (let k = 1; k < xs.length; k += 1) assert.ok(xs[k] - xs[k - 1] >= 46);
  assert.ok(xs.every((x) => 1300 - x >= 46));
  assert.deepEqual(rulerMarks(offsets, 155, 0), offsets);
});

test('clean export quote checks the margin on the real charge', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261019120000_fix_clean_export_quote.sql', import.meta.url), 'utf8');
  assert.match(sql, /charged := greatest\(r\.credits, price\)::integer;/);
  assert.match(sql, /margin := \(\(charged - total_cost/);
});
