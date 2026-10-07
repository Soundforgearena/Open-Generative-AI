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
  { href: '/admin/cockpit', label: 'Economics cockpit', blurb: 'Margin, liability and data-source status.', superOnly: true },
  { href: '/admin/connect', label: 'Revenue partners', blurb: 'Revenue split, partner onboarding and payouts.', superOnly: true },
  { href: '/admin/stripe-readiness', label: 'Stripe readiness', blurb: 'Checkout and webhook configuration checks.' },
];

/** Sections a role can see. Revenue and partner sections are super admin only. */
export function sectionsForRole(role) {
  return ADMIN_SECTIONS.filter((section) => !section.superOnly || role === 'super_admin');
}
