import test from 'node:test';
import assert from 'node:assert/strict';
import navigation from '../electron/lib/externalNavigation.js';

test('desktop external links permit web/mail but never executable or local schemes', () => {
  for (const url of ['https://cinexvideo.app', 'http://example.com', 'mailto:help@example.com']) {
    assert.equal(navigation.safeExternalUrl(url), true);
  }
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hello', 'ms-excel:ofe|u|file:///tmp/a', 'https://u:p@example.com', 'not a URL']) {
    assert.equal(navigation.safeExternalUrl(url), false);
  }
});
