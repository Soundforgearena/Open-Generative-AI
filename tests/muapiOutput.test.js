import test from 'node:test';
import assert from 'node:assert/strict';
import { muapiOutput, firstOutputUrl } from '../lib/providers/muapi-output.js';

// Shape captured from a real MuAPI pixverse-v6-t2v result (Oct 15 2026).
const real = {
  id: '4caf6b9a-4a9d-400f-9fcb-d4d3f95ec80d',
  status: 'completed',
  outputs: ['https://cdn.muapi.ai/outputs/generated/4caf6b9a_57648cb3.mp4'],
  cost: { amount_usd: 0.295 },
};

test('reads the video link from MuAPI outputs[]', () => {
  assert.equal(firstOutputUrl(muapiOutput(real)), real.outputs[0]);
});

test('still reads older output/result shapes', () => {
  assert.equal(firstOutputUrl(muapiOutput({ output: 'https://a.example/v.mp4' })), 'https://a.example/v.mp4');
  assert.equal(firstOutputUrl(muapiOutput({ result: [{ video_url: 'https://b.example/v.mp4' }] })), 'https://b.example/v.mp4');
  assert.equal(firstOutputUrl(muapiOutput({ outputs: [], output: 'https://c.example/v.mp4' })), 'https://c.example/v.mp4');
});

test('no usable https link returns null so the job is refunded, not charged', () => {
  assert.equal(firstOutputUrl(muapiOutput({ status: 'completed' })), null);
  assert.equal(firstOutputUrl(muapiOutput({ outputs: [] })), null);
  assert.equal(firstOutputUrl(muapiOutput({ outputs: ['javascript:alert(1)'] })), null);
  assert.equal(firstOutputUrl(muapiOutput({ outputs: ['http://insecure.example/v.mp4'] })), null);
});
