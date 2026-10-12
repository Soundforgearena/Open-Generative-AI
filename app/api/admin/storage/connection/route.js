import { guard, safeError } from '../../../../../lib/cinexvideo-server';
import { rateLimit } from '../../../../../lib/rate-limit';
import { encryptionReady, publicR2Status, resolveR2Binding, r2Environment, sealR2Keys, validateR2Keys } from '../../../../../lib/storage/r2-config';
import { ensureR2Bucket, savedR2Connection, saveR2Connection } from '../../../../../lib/storage/r2-server';
import { testStorageConnection } from '../../../../../lib/storage/provider';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request) {
  const { error, superAdmin } = await guard(request, { requireAdminRole: true });
  if (error) return error;
  try {
    return Response.json({ storage: publicR2Status(await savedR2Connection()), canChange: Boolean(superAdmin) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return safeError('Storage settings could not be loaded.', 503); }
}

export async function POST(request) {
  const { user, error } = await guard(request, { requireSuperAdmin: true });
  if (error) return error;
  const limited = rateLimit(`r2-connect:${user.id}`, { limit: 5, windowMs: 60_000 });
  if (limited) return limited;
  if (!encryptionReady()) return safeError('Storage credential encryption is not initialized on the server. Your keys were not saved.', 503);
  if (Number(request.headers.get('content-length') || 0) > 4096) return safeError('Storage settings are too large.', 413);
  let body;
  try {
    const text = await request.text();
    if (text.length > 4096) return safeError('Storage settings are too large.', 413);
    body = JSON.parse(text);
  } catch { return safeError('Invalid storage settings.'); }
  try {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return safeError('Invalid storage settings.');
    const previous = await savedR2Connection();
    const binding = resolveR2Binding(body.binding || previous?.binding || {});
    if (previous?.credentials && JSON.stringify(binding) !== JSON.stringify(resolveR2Binding(previous.binding))) {
      return safeError('This connection already owns media. Only key rotation is supported here; changing its account or bucket requires a storage migration.', 409);
    }
    const keys = validateR2Keys(body);
    const env = r2Environment(binding, keys);
    const bucket = await ensureR2Bucket(env);
    const check = await testStorageConnection({ env });
    if (!check.ok) return Response.json({
      error: `R2 verification failed at the ${check.step} step. Check bucket access and Object Read & Write permission. Existing settings were not changed.`,
      check,
    }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
    const value = {
      binding, credentials: sealR2Keys(keys, binding),
      keyHint: keys.accessKeyId.slice(-4), verifiedAt: new Date().toISOString(),
    };
    await saveR2Connection(value, user.id, previous);
    return Response.json({ storage: publicR2Status(value), canChange: true, bucketCreated: bucket.created }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    // Never log submitted keys, signed URLs or upstream response bodies.
    const safeMessages = [
      'Invalid Cloudflare account ID.', 'Invalid R2 bucket name.', 'Invalid R2 jurisdiction.',
      'Enter the R2 Access Key ID, not a Cloudflare API token.',
      'Enter the R2 Secret Access Key shown when the R2 token was created.',
      'The verified storage connection could not be saved.',
      'Cloudflare could not verify the target bucket. Try again.',
      'The private bucket does not exist and these keys cannot create it. Create the displayed bucket once in Cloudflare, or choose your existing bucket under Advanced.',
    ];
    return safeError(safeMessages.includes(error.message) ? error.message : 'R2 could not be connected. Your existing connection was not changed.', 422);
  }
}
