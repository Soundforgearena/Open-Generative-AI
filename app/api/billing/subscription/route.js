import { guard, selectOne, selectRows, safeError } from '../../../../lib/cinexvideo-server';
import {
  stripeEnabled,
  createSubscriptionCheckoutSession,
  setSubscriptionCancelAtPeriodEnd,
} from '../../../../lib/stripe-connect';
import { currentPaymentMode } from '../../../../lib/billing/payment-mode-server';
import { canCheckout } from '../../../../lib/billing/payment-mode';

export const dynamic = 'force-dynamic';

const LIVE = new Set(['active', 'trialing', 'past_due']);

function publicSubscription(row) {
  if (!row) return null;
  return {
    plan_code: row.plan_code,
    status: row.status,
    current_period_end: row.current_period_end,
    cancel_at_period_end: row.cancel_at_period_end,
    live: LIVE.has(row.status),
    sandbox: row.livemode === false,
  };
}

/** Monthly plans on sale plus the signed-in user's current plan. */
export async function GET(request) {
  const { user, admin, error } = await guard(request);
  if (error) return error;
  const mode = await currentPaymentMode();
  const [plans, current] = await Promise.all([
    selectRows('billing_plans', { active: 'eq.true', monthly_price_cents: 'gt.0', order: 'sort_order.asc' },
      'code,name,monthly_price_cents,included_credits,blurb'),
    selectOne('user_subscriptions', { user_id: `eq.${user.id}` },
      'plan_code,status,current_period_end,cancel_at_period_end,livemode'),
  ]);
  return Response.json({
    plans,
    subscription: publicSubscription(current),
    checkout_enabled: stripeEnabled(mode) && canCheckout(mode, { admin }),
    sandbox: mode === 'test',
  });
}

/** Start a monthly plan through Stripe's hosted checkout. */
export async function POST(request) {
  const { user, admin, error } = await guard(request);
  if (error) return error;
  const mode = await currentPaymentMode();
  if (!canCheckout(mode, { admin })) return safeError('Monthly plans open soon.', 503);
  if (!stripeEnabled(mode)) return safeError('Monthly plans are not available on this deployment yet.', 503);

  try {
    const body = await request.json().catch(() => ({}));
    const plan = await selectOne('billing_plans', { code: `eq.${body.plan_code}`, active: 'eq.true' });
    if (!plan || !(plan.monthly_price_cents > 0)) return safeError('That plan is not available.', 404);

    const current = await selectOne('user_subscriptions', { user_id: `eq.${user.id}` }, 'status,livemode');
    // A sandbox plan never blocks a real one (and vice versa).
    if (current && LIVE.has(current.status) && current.livemode === (mode === 'live')) {
      return safeError('You already have a monthly plan. Cancel it first to switch plans.', 409);
    }

    const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const session = await createSubscriptionCheckoutSession({
      plan,
      userId: user.id,
      userEmail: user.email,
      successUrl: `${origin}/account?plan=success`,
      cancelUrl: `${origin}/account?plan=cancelled`,
      mode,
    });
    return Response.json({ url: session.url });
  } catch (err) {
    console.error('subscription checkout', err);
    return safeError('Could not start checkout. Please try again.', 502);
  }
}

/** Cancel at the end of the paid month, or keep the plan after cancelling. */
export async function PATCH(request) {
  const { user, error } = await guard(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  if (!['cancel', 'resume'].includes(body.action)) return safeError('Unknown action.', 400);
  const current = await selectOne('user_subscriptions', { user_id: `eq.${user.id}` });
  if (!current?.stripe_subscription_id || !LIVE.has(current.status)) return safeError('You have no active monthly plan.', 404);

  try {
    // The webhook (customer.subscription.updated) writes the new state back.
    const subMode = current.livemode === false ? 'test' : 'live';
    if (!stripeEnabled(subMode)) return safeError('Monthly plans are not available on this deployment yet.', 503);
    const sub = await setSubscriptionCancelAtPeriodEnd(current.stripe_subscription_id, body.action === 'cancel', subMode);
    return Response.json({
      subscription: publicSubscription({
        ...current,
        cancel_at_period_end: sub.cancel_at_period_end,
        status: sub.status,
      }),
    });
  } catch (err) {
    console.error('subscription update', err);
    return safeError('Could not update your plan. Please try again.', 502);
  }
}
