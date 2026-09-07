/**
 * Admin section list.
 *
 * Kept in a framework-neutral module so both server components and client
 * components can read it. Exporting this from a `'use client'` module made
 * every /admin route throw a server-side exception, because a server component
 * cannot read a value across the client boundary.
 */
export const ADMIN_SECTIONS = [
  { href: '/admin', label: 'Overview', blurb: 'Live platform, credit and generation health.' },
  { href: '/admin/cockpit', label: 'Economics cockpit', blurb: 'Margin, liability and data-source status.' },
  { href: '/admin/connect', label: 'Revenue partners', blurb: 'Partner onboarding and payout accounts.' },
  { href: '/admin/stripe-readiness', label: 'Stripe readiness', blurb: 'Checkout and webhook configuration checks.' },
];
