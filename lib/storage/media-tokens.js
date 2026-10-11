import { createHmac, timingSafeEqual } from 'node:crypto';

function tokenKey(env) {
  if (!/^[a-f0-9]{64}$/i.test(env.STORAGE_CREDENTIALS_ENCRYPTION_KEY || '')) throw new Error('Media signing is unavailable.');
  return Buffer.from(env.STORAGE_CREDENTIALS_ENCRYPTION_KEY, 'hex');
}

export function parseR2Path(path) {
  if (typeof path !== 'string' || path.length > 1024) throw new Error('Invalid media path.');
  const match = /^r2:\/\/([a-z0-9][a-z0-9-]{1,61}[a-z0-9])\/(refs\/[a-zA-Z0-9/_-]+)$/.exec(path);
  if (!match || match[2].split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Invalid media path.');
  return { bucket: match[1], key: match[2] };
}

export function r2AssetPathMatches(asset, ownerId) {
  try {
    return parseR2Path(asset.storage_path).key === `refs/${ownerId}/${asset.project_id}/${asset.id}`;
  } catch { return false; }
}

const signature = (path, expires, env) => createHmac('sha256', tokenKey(env)).update(`r2-read-v1\n${path}\n${expires}`).digest('hex');

export function mediaReadUrl(path, expiresIn = 900, env = process.env, now = Date.now()) {
  parseR2Path(path);
  const site = new URL(env.NEXT_PUBLIC_SITE_URL || env.NEXT_PUBLIC_APP_URL || 'https://cinexvideo.app');
  if (site.protocol !== 'https:') throw new Error('Media origin must use HTTPS.');
  const expires = Math.floor(now / 1000) + Math.min(3600, Math.max(1, Number(expiresIn) || 900));
  const query = new URLSearchParams({ path, expires: String(expires), signature: signature(path, expires, env) });
  return `${site.origin}/api/storage/media?${query}`;
}

export function verifyMediaRead(path, expires, provided, env = process.env, now = Date.now()) {
  try {
    parseR2Path(path);
    const end = Number(expires);
    const current = Math.floor(now / 1000);
    if (!Number.isSafeInteger(end) || end <= current || end > current + 3600 || !/^[a-f0-9]{64}$/.test(provided || '')) return false;
    return timingSafeEqual(Buffer.from(signature(path, end, env), 'hex'), Buffer.from(provided, 'hex'));
  } catch { return false; }
}

/** Count actual bytes, not only the caller's declared Content-Length. */
export function exactSizeStream(stream, expectedBytes) {
  if (!stream || !Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > 60 * 1024 * 1024) throw new Error('Invalid media size.');
  let bytes = 0;
  return stream.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > expectedBytes) throw new Error('Upload exceeds the approved size.');
      controller.enqueue(chunk);
    },
    flush() {
      if (bytes !== expectedBytes) throw new Error('Upload did not match the approved size.');
    },
  }));
}
