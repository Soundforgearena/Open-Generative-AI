/**
 * Report which backend providers are configured, without ever exposing a value.
 *
 * Until now nothing in the admin surface reported whether OPENAI_API_KEY or
 * MUAPI_API_KEY were present, so the only way to discover a missing provider
 * credential was to trigger a real generation and read the failure. This
 * returns a presence-only summary so configuration can be checked directly.
 *
 * Only booleans and static descriptions are returned. No secret, no prefix and
 * no length is included, so the result is safe to send to an authorised admin
 * client.
 */

const PROVIDERS = [
  {
    key: 'supabase',
    label: 'Supabase',
    vars: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
    required: true,
    impact: 'Sign-in, credits and every authenticated route stop working.',
  },
  {
    key: 'muapi',
    label: 'MuAPI (video and image generation)',
    vars: ['MUAPI_API_KEY'],
    required: true,
    impact: 'No video or image can be generated. Generation, job polling and reconciliation all fail.',
  },
  {
    key: 'openai',
    label: 'OpenAI (AI Director)',
    vars: ['OPENAI_API_KEY'],
    required: true,
    impact: 'AI Director cannot produce drafts or scene plans.',
  },
  {
    key: 'stripe',
    label: 'Stripe (payments)',
    vars: ['STRIPE_SECRET_KEY'],
    required: false,
    impact: 'Credit purchases and payouts are unavailable. See Stripe readiness for detail.',
  },
  {
    key: 'stripe_webhook',
    label: 'Stripe webhook signing secret',
    vars: ['STRIPE_WEBHOOK_SECRET', 'CINEXVIDEO_STRIPE_WEBHOOK_SECRET'],
    anyOf: true,
    required: false,
    impact: 'Purchases complete at Stripe but credits are never granted.',
  },
  {
    key: 'cron',
    label: 'Cron shared secret',
    vars: ['CRON_SECRET'],
    required: false,
    impact: 'Scheduled reconciliation and payout routes reject every request.',
  },
];

function isSet(env, name) {
  const value = env[name];
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * @param {Record<string, string | undefined>} env
 */
export function describeProviderConfiguration(env = {}) {
  return PROVIDERS.map((provider) => {
    const present = provider.vars.filter((name) => isSet(env, name));
    const configured = provider.anyOf ? present.length > 0 : present.length === provider.vars.length;
    return {
      key: provider.key,
      label: provider.label,
      configured,
      required: provider.required,
      impact: provider.impact,
      // Names only. Useful for telling an operator exactly what to set.
      missing: provider.anyOf
        ? configured
          ? []
          : [provider.vars.join(' or ')]
        : provider.vars.filter((name) => !isSet(env, name)),
    };
  });
}

/**
 * True when every provider marked required is configured.
 */
export function coreProvidersReady(env = {}) {
  return describeProviderConfiguration(env)
    .filter((provider) => provider.required)
    .every((provider) => provider.configured);
}

export { PROVIDERS };
