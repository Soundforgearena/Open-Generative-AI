import { guard, insertRows, safeError } from '../../../../lib/cinexvideo-server';
import { PAYMENT_MODE_SETTING, PAYMENT_MODES, modeReadiness } from '../../../../lib/billing/payment-mode';
import { currentPaymentMode } from '../../../../lib/billing/payment-mode-server';

export const dynamic = 'force-dynamic';

/** Current payment mode and whether each mode's keys are configured. */
export async function GET(request) {
  const { error, superAdmin } = await guard(request, { requireAdminRole: true });
  if (error) return error;
  return Response.json({
    mode: await currentPaymentMode(),
    can_change: Boolean(superAdmin),
    test: modeReadiness('test'),
    live: modeReadiness('live'),
  });
}

/** Super admins only: switch customer payments between sandbox and live. */
export async function POST(request) {
  const { user, error } = await guard(request, { requireSuperAdmin: true });
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  const mode = body.mode;
  if (!PAYMENT_MODES.includes(mode)) return safeError('Unknown payment mode.', 400);
  if (mode === 'live' && body.confirm !== 'LIVE') {
    return safeError('Type LIVE to confirm switching to real payments.', 400);
  }
  const readiness = modeReadiness(mode);
  if (!readiness.ready) {
    const missing = mode === 'test'
      ? 'STRIPE_TEST_SECRET_KEY (sk_test_...) and STRIPE_TEST_WEBHOOK_SECRET'
      : 'STRIPE_SECRET_KEY (sk_live_...) and STRIPE_WEBHOOK_SECRET';
    return safeError(`${mode === 'test' ? 'Sandbox' : 'Live'} Stripe is not configured. Add ${missing} in Railway first.`, 409);
  }
  const saved = await insertRows(
    'app_settings',
    { key: PAYMENT_MODE_SETTING, value: { mode }, updated_at: new Date().toISOString(), updated_by: user.id },
    { upsert: true }
  );
  if (!saved.ok) return safeError('Payment mode could not be saved.', 500);
  return Response.json({ mode, test: modeReadiness('test'), live: modeReadiness('live') });
}
