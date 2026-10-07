import test from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../sre/engine/validate.js';

test('validation output redacts bearer tokens and service secrets', () => {
  const output = redact('Authorization: Bearer abc.def.ghi OPENAI_API_KEY=secret CRON_SECRET=cron');
  assert.equal(output.includes('abc.def.ghi'), false);
  assert.equal(output.includes('secret'), false);
  assert.equal(output.includes('cron'), false);
  assert.match(output, /REDACTED/);
});
