import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const R2_SETTING = 'r2_storage_connection_v1';
export const DEFAULT_R2_BUCKET = 'cinexvideo-vault';
// Public account identifier verified through the owner's Cloudflare connector.
// This is NOT a key. Deployment can override it without exposing credentials.
export const CINEX_R2_ACCOUNT = '64897aa07bba43a38a79a7f17201340f';

function encryptionKey(env) {
  const value = env.STORAGE_CREDENTIALS_ENCRYPTION_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('Storage credential encryption is not initialized on the server.');
  return Buffer.from(value, 'hex');
}

export function encryptionReady(env = process.env) {
  return /^[a-f0-9]{64}$/i.test(env.STORAGE_CREDENTIALS_ENCRYPTION_KEY || '');
}

export function resolveR2Binding(input = {}, env = process.env) {
  const accountId = String(input.accountId || env.CLOUDFLARE_ACCOUNT_ID || CINEX_R2_ACCOUNT).trim();
  const bucket = String(input.bucket || env.R2_BUCKET || DEFAULT_R2_BUCKET).trim();
  const jurisdiction = String(input.jurisdiction || env.R2_JURISDICTION || 'default');
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('Invalid Cloudflare account ID.');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('Invalid R2 bucket name.');
  if (!['default', 'eu', 'us', 'fedramp'].includes(jurisdiction)) throw new Error('Invalid R2 jurisdiction.');
  return { accountId, bucket, jurisdiction, endpoint: `https://${accountId}${jurisdiction === 'default' ? '' : `.${jurisdiction}`}.r2.cloudflarestorage.com` };
}

export function validateR2Keys(input) {
  const accessKeyId = String(input.accessKeyId || '').trim();
  const secretAccessKey = String(input.secretAccessKey || '').trim();
  if (!/^[a-f0-9]{32}$/i.test(accessKeyId)) throw new Error('Enter the R2 Access Key ID, not a Cloudflare API token.');
  if (!/^[a-f0-9]{64}$/i.test(secretAccessKey)) throw new Error('Enter the R2 Secret Access Key shown when the R2 token was created.');
  return { accessKeyId, secretAccessKey };
}

const aad = (binding) => Buffer.from(JSON.stringify([R2_SETTING, binding.accountId, binding.bucket, binding.jurisdiction]));

export function sealR2Keys(keys, binding, env = process.env) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(env), iv);
  cipher.setAAD(aad(binding));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(keys), 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: encrypted.toString('base64') };
}

export function openR2Keys(envelope, binding, env = process.env) {
  try {
    if (envelope?.version !== 1) throw new Error('Unknown credential version');
    const cipher = createDecipheriv('aes-256-gcm', encryptionKey(env), Buffer.from(envelope.iv, 'base64'));
    cipher.setAAD(aad(binding));
    cipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return validateR2Keys(JSON.parse(Buffer.concat([
      cipher.update(Buffer.from(envelope.ciphertext, 'base64')), cipher.final(),
    ]).toString('utf8')));
  } catch { throw new Error('Saved R2 credentials cannot be unlocked. Restore the server encryption key before retrying.'); }
}

export function r2Environment(binding, keys) {
  return {
    STORAGE_S3_ENDPOINT: binding.endpoint, STORAGE_S3_BUCKET: binding.bucket,
    STORAGE_S3_ACCESS_KEY_ID: keys.accessKeyId, STORAGE_S3_SECRET_ACCESS_KEY: keys.secretAccessKey,
    STORAGE_S3_REGION: 'auto',
  };
}

export function publicR2Status(saved, env = process.env) {
  const binding = resolveR2Binding(saved?.binding || {}, env);
  return {
    configured: Boolean(saved?.credentials),
    verified: Boolean(saved?.credentials && saved?.verifiedAt),
    provider: 'Cloudflare R2', ...binding,
    keyHint: saved?.keyHint || null,
    verifiedAt: saved?.verifiedAt || null,
    encryptionReady: encryptionReady(env),
    transferMode: 'server-mediated',
    region: 'auto',
  };
}
