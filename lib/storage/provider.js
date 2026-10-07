// Storage server hookup for Creator Vault and CineX Premieres.
//
// Works with any S3-compatible storage: Cloudflare R2 (recommended: no
// bandwidth fees for viewers), Backblaze B2, Wasabi, AWS S3, DigitalOcean
// Spaces, or your own server running MinIO. Set these in Railway and the
// admin cockpit will show it as connected:
//
//   STORAGE_S3_ENDPOINT          e.g. https://<account>.r2.cloudflarestorage.com
//   STORAGE_S3_BUCKET            e.g. cinexvideo-vault
//   STORAGE_S3_ACCESS_KEY_ID
//   STORAGE_S3_SECRET_ACCESS_KEY
//   STORAGE_S3_REGION            optional, "auto" for R2 (default)
//   STORAGE_PUBLIC_BASE_URL      optional CDN domain for published episodes
//
// No SDK needed: requests are signed with AWS Signature V4 directly.

import { createHash, createHmac } from 'node:crypto';

export const STORAGE_ENV = ['STORAGE_S3_ENDPOINT', 'STORAGE_S3_BUCKET', 'STORAGE_S3_ACCESS_KEY_ID', 'STORAGE_S3_SECRET_ACCESS_KEY'];

const set = (env, k) => typeof env[k] === 'string' && env[k].trim() !== '';

/** Presence-only status; never returns a secret. */
export function describeStorage(env = process.env) {
  const missing = STORAGE_ENV.filter((k) => !set(env, k));
  let host = null;
  try { host = set(env, 'STORAGE_S3_ENDPOINT') ? new URL(env.STORAGE_S3_ENDPOINT).hostname : null; } catch { host = 'invalid'; }
  const provider = !host ? null
    : host.endsWith('r2.cloudflarestorage.com') ? 'Cloudflare R2'
    : host.includes('backblazeb2') ? 'Backblaze B2'
    : host.includes('wasabisys') ? 'Wasabi'
    : host.includes('amazonaws.com') ? 'Amazon S3'
    : host.includes('digitaloceanspaces') ? 'DigitalOcean Spaces'
    : 'Your server (S3-compatible)';
  return {
    configured: missing.length === 0 && host !== 'invalid',
    missing,
    provider,
    bucket: set(env, 'STORAGE_S3_BUCKET') ? env.STORAGE_S3_BUCKET : null,
    cdn: set(env, 'STORAGE_PUBLIC_BASE_URL'),
  };
}

function config(env = process.env) {
  const status = describeStorage(env);
  if (!status.configured) throw new Error('Storage server is not connected yet.');
  return {
    endpoint: env.STORAGE_S3_ENDPOINT.replace(/\/+$/, ''),
    bucket: env.STORAGE_S3_BUCKET,
    accessKey: env.STORAGE_S3_ACCESS_KEY_ID,
    secretKey: env.STORAGE_S3_SECRET_ACCESS_KEY,
    region: env.STORAGE_S3_REGION || 'auto',
  };
}

const sha256 = (v) => createHash('sha256').update(v).digest('hex');
const hmac = (key, v) => createHmac('sha256', key).update(v).digest();
const encodeKey = (key) => key.split('/').map((p) => encodeURIComponent(p)).join('/');

function stamp(now) {
  const iso = new Date(now).toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amz: iso, day: iso.slice(0, 8) };
}

function signingKey(secret, day, region) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), 's3'), 'aws4_request');
}

/**
 * Presigned URL so a browser can upload (PUT) or play/download (GET) a file
 * directly, without passing through this server.
 */
export function presignUrl(method, key, { expiresIn = 900, env = process.env, now = Date.now() } = {}) {
  const c = config(env);
  const url = new URL(`${c.endpoint}/${c.bucket}/${encodeKey(key)}`);
  const { amz, day } = stamp(now);
  const scope = `${day}/${c.region}/s3/aws4_request`;
  const params = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${c.accessKey}/${scope}`,
    'X-Amz-Date': amz,
    'X-Amz-Expires': String(Math.min(604800, Math.max(1, expiresIn))),
    'X-Amz-SignedHeaders': 'host',
  });
  const query = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const canonical = [method, url.pathname, query, `host:${url.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha256(canonical)].join('\n');
  const signature = createHmac('sha256', signingKey(c.secretKey, day, c.region)).update(toSign).digest('hex');
  return `${url.origin}${url.pathname}?${query}&X-Amz-Signature=${signature}`;
}

/** Admin "Test connection": writes, reads back and deletes a tiny file. */
export async function testStorageConnection({ env = process.env } = {}) {
  const key = `_cinex-healthcheck/${Date.now()}.txt`;
  const body = 'CineXVideo storage check';
  const started = Date.now();
  const put = await fetch(presignUrl('PUT', key, { env, expiresIn: 60 }), { method: 'PUT', body });
  if (!put.ok) return { ok: false, step: 'write', status: put.status };
  const get = await fetch(presignUrl('GET', key, { env, expiresIn: 60 }));
  const text = get.ok ? await get.text() : '';
  if (text !== body) return { ok: false, step: 'read', status: get.status };
  const del = await fetch(presignUrl('DELETE', key, { env, expiresIn: 60 }), { method: 'DELETE' });
  return { ok: del.ok || del.status === 204, step: 'done', ms: Date.now() - started };
}
