const test = require('node:test');
const assert = require('node:assert/strict');

function demoEnabled(env) {
  return env.NODE_ENV !== 'production' && env.NEXT_PUBLIC_DEMO_MODE === 'true';
}

test('demo mode is never enabled in production', () => {
  assert.equal(demoEnabled({ NODE_ENV: 'production', NEXT_PUBLIC_DEMO_MODE: 'true' }), false);
  assert.equal(demoEnabled({ NODE_ENV: 'development', NEXT_PUBLIC_DEMO_MODE: 'true' }), true);
});

test('malformed local project data falls back to an empty list', () => {
  const parseProjects = (value) => {
    try {
      const parsed = JSON.parse(value || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  assert.deepEqual(parseProjects('{bad json'), []);
  assert.deepEqual(parseProjects('{"project":true}'), []);
});

test('storyboard duration selects a bounded scene count', () => {
  const count = (duration) => duration <= 15 ? 3 : duration <= 30 ? 5 : duration <= 60 ? 6 : 8;
  assert.equal(count(15), 3);
  assert.equal(count(30), 5);
  assert.equal(count(60), 6);
  assert.equal(count(120), 8);
});

test('safe project input rejects an empty title and source', () => {
  const validate = (values) => (!values.title?.trim() || !values.sourceText?.trim()) === true;
  assert.equal(validate({ title: '', sourceText: '' }), true);
  assert.equal(validate({ title: 'Night Signal', sourceText: 'An astronaut waits.' }), false);
});
