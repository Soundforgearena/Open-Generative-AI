import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveUploadType, validateUploadDetails } from '../lib/upload-validation.js';

describe('upload validation', () => {
  it('accepts a normal image reference', () => {
    assert.deepEqual(
      Object.fromEntries(Object.entries(validateUploadDetails({
        kind: 'character',
        filename: 'hero.webp',
        contentType: 'image/webp',
        sizeBytes: 1024,
      })).filter(([key]) => ['ok', 'contentType'].includes(key))),
      { ok: true, contentType: 'image/webp' }
    );
  });

  it('accepts a normal audio reference', () => {
    assert.deepEqual(
      Object.fromEntries(Object.entries(validateUploadDetails({
        kind: 'audio',
        filename: 'song.mp3',
        contentType: 'audio/mpeg',
        sizeBytes: 5 * 1024 * 1024,
      })).filter(([key]) => ['ok', 'contentType'].includes(key))),
      { ok: true, contentType: 'audio/mpeg' }
    );
  });

  it('rejects audio placed in an image kind', () => {
    assert.equal(
      resolveUploadType({
        kind: 'location',
        filename: 'renamed.mp3',
        contentType: 'image/png',
      }).ok,
      false
    );
  });

  it('rejects oversized images at the stricter application cap', () => {
    const result = validateUploadDetails({
        kind: 'reference',
        filename: 'huge.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 16 * 1024 * 1024,
      });
    assert.equal(result.ok, false);
    assert.equal(result.status, 413);
  });

  it('rejects oversized audio', () => {
    const result = validateUploadDetails({
        kind: 'audio',
        filename: 'huge.wav',
        contentType: 'audio/wav',
        sizeBytes: 61 * 1024 * 1024,
      });
    assert.equal(result.ok, false);
    assert.equal(result.status, 413);
  });

  it('rejects svg even when declared as an image', () => {
    assert.equal(
      resolveUploadType({
        kind: 'reference',
        filename: 'script.svg',
        contentType: 'image/svg+xml',
      }).ok,
      false
    );
  });
});
