import { safeError } from '../../../../lib/cinexvideo-server';

/**
 * Retired. Partner payouts are set up only through /api/partners/connect, so
 * there is exactly one place that can create a partner's Stripe account.
 */
export const dynamic = 'force-dynamic';

export async function POST() {
  return safeError('This endpoint has moved. Set up payouts from the Payouts page.', 410);
}
