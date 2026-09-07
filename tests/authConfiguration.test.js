const test = require('node:test');
const assert = require('node:assert/strict');

const { isValidSupabaseUrl, getSafeNextPath, getOAuthRedirectUrl } = require('../lib/supabase-browser.js');

test('Supabase URL validation accepts hosted and local development URLs', () => {
  assert.equal(isValidSupabaseUrl('https://example.supabase.co'), true);
  assert.equal(isValidSupabaseUrl('https://supabase.example.internal'), true);
  assert.equal(isValidSupabaseUrl('http://localhost:54321'), true);
  assert.equal(isValidSupabaseUrl('http://127.0.0.1:54321'), true);
});

test('Supabase URL validation rejects unsafe schemes', () => {
  assert.equal(isValidSupabaseUrl('javascript:alert(1)'), false);
  assert.equal(isValidSupabaseUrl('http://supabase.example.internal'), false);
  assert.equal(isValidSupabaseUrl('not-a-url'), false);
});

test('OAuth next paths remain constrained to local paths', () => {
  assert.equal(getSafeNextPath('/create'), '/create');
  assert.equal(getSafeNextPath('//evil.example'), '/dashboard');
  assert.equal(getSafeNextPath('/\\evil.example'), '/dashboard');
  assert.equal(getSafeNextPath('https://evil.example'), '/dashboard');
});

test('OAuth redirect helper has a callback path in the browser', () => {
  assert.equal(getOAuthRedirectUrl('/create'), '/auth/callback');
});
