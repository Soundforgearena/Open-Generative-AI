import { selectOne, insertRows, updateRows } from '../cinexvideo-server';
import { R2_SETTING, openR2Keys, resolveR2Binding, r2Environment } from './r2-config.js';
import { presignUrl } from './provider.js';

export async function savedR2Connection() {
  const row = await selectOne('app_settings', { key: `eq.${R2_SETTING}` }, 'value');
  return row?.value || null;
}

export async function activeR2Environment() {
  const saved = await savedR2Connection();
  if (!saved?.credentials || !saved?.verifiedAt) throw new Error('Connect Cloudflare R2 in Admin settings before uploading media.');
  const binding = resolveR2Binding(saved.binding);
  return r2Environment(binding, openR2Keys(saved.credentials, binding));
}

export async function saveR2Connection(value, userId, previous = null) {
  const payload = { value, updated_by: userId, updated_at: new Date().toISOString() };
  const result = previous
    ? await updateRows('app_settings', { key: `eq.${R2_SETTING}`, 'value->>verifiedAt': `eq.${previous.verifiedAt}` }, payload)
    : await insertRows('app_settings', { key: R2_SETTING, ...payload });
  if (!result.ok || !result.data?.length) throw new Error('The verified storage connection could not be saved.');
}

/** Only creates the named private bucket; never changes DNS, CORS or publicity. */
export async function ensureR2Bucket(env, { fetchImpl = fetch } = {}) {
  const head = await fetchImpl(presignUrl('HEAD', '', { env, expiresIn: 60 }), {
    method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (head.ok || head.status === 403) return { created: false };
  if (head.status !== 404) throw new Error('Cloudflare could not verify the target bucket. Try again.');
  const created = await fetchImpl(presignUrl('PUT', '', { env, expiresIn: 60 }), {
    method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!created.ok) throw new Error('The private bucket does not exist and these keys cannot create it. Create the displayed bucket once in Cloudflare, or choose your existing bucket under Advanced.');
  return { created: true };
}
