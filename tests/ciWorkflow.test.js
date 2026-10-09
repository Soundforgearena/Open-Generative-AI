import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('CI runs tests, lint, and build for pull requests and relevant pushes', async () => {
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

  assert.match(workflow, /^name: CI$/m);
  assert.match(workflow, /^\s{2}pull_request:\s*$/m);
  assert.match(workflow, /^\s{6}- main\s*$/m);
  assert.match(workflow, /^\s{6}- 'copilot\/\*\*'\s*$/m);
  assert.match(workflow, /^\s{2}test:\s*$/m);
  assert.match(workflow, /run: npm test/);
  assert.match(workflow, /run: npm run lint/);
  assert.match(workflow, /run: npm run build/);
  assert.match(workflow, /NEXT_TELEMETRY_DISABLED: '1'/);
  assert.match(workflow, /TZ: UTC/);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
});
