import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { isPublicAddress, isFetchableMediaUrl, openPublicMedia } from '../lib/exports/public-media.js';

test('media URLs reject credentials, non-HTTPS, ports, IP literals and private hostnames', () => {
  for (const url of ['http://cdn.example.com/a', 'https://u:p@cdn.example.com/a', 'https://cdn.example.com:8443/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://localhost./a', 'https://a.local/a']) {
    assert.equal(isFetchableMediaUrl(url), false, url);
  }
  assert.equal(isFetchableMediaUrl('https://cdn.example.com/a.mp4'), true);
});

test('DNS records reject private and special-purpose destinations', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.1', '169.254.169.254', '100.64.1.2', '0.0.0.0', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2002:7f00:1::', '2001:db8::1']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('vetted DNS addresses are pinned to the TLS request', async () => {
  let dnsCalls = 0;
  const resolve = async () => { dnsCalls++; return [{ address: '8.8.8.8', family: 4 }]; };
  const request = (_url, options, callback) => {
    assert.equal(options.agent, false);
    options.lookup('cdn.example.com', {}, (_err, address, family) => {
      assert.equal(address, '8.8.8.8'); assert.equal(family, 4);
    });
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.end = () => {
      const response = new PassThrough();
      response.statusCode = 200; response.headers = {};
      callback(response); response.end('media');
    };
    return req;
  };
  const response = await openPublicMedia('https://cdn.example.com/video', { resolve, request });
  assert.equal(dnsCalls, 1);
  response.destroy();
});

test('hostname resolving privately is blocked before connecting', async () => {
  await assert.rejects(openPublicMedia('https://cdn.example.com/a', {
    resolve: async () => [{ address: '10.0.0.1', family: 4 }],
    request: () => { throw new Error('should not connect'); },
  }), /not public/);
});

test('redirects cannot escape to private destinations', async () => {
  let requests = 0;
  const request = (_url, _options, callback) => {
    requests++;
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.end = () => {
      const response = new PassThrough();
      response.statusCode = 302;
      response.headers = { location: 'https://169.254.169.254/latest' };
      callback(response);
    };
    return req;
  };
  await assert.rejects(openPublicMedia('https://cdn.example.com/a', {
    resolve: async () => [{ address: '8.8.8.8', family: 4 }], request,
  }), /unsupported media url/);
  assert.equal(requests, 1);
});
