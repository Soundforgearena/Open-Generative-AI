import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Director assist requires auth and enforces credit billing', async () => {
  const route = await read('app/api/director/route.js');
  assert.match(route, /const \{ user, error \} = await guard\(request, \{ blockOnMaintenance: true \}\)/);
  assert.match(route, /callRpc\('reserve_credits'/);
  assert.match(route, /callDirectorModel/);
  assert.match(route, /callRpc\('consume_credits'/);
  assert.match(route, /callRpc\('release_credits'/);
  assert.match(route, /Insufficient credits for Director assist\. Please top up and try again\./);
  assert.match(route, /insertRows\('admin_metric_events'/);
  assert.match(route, /event_type: 'director_assist'/);
});
