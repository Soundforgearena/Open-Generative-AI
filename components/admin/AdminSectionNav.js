'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const ADMIN_SECTIONS = [
  { href: '/admin', label: 'Overview', blurb: 'Live platform, credit and generation health.' },
  { href: '/admin/cockpit', label: 'Economics cockpit', blurb: 'Margin, liability and data-source status.' },
  { href: '/admin/connect', label: 'Revenue partners', blurb: 'Partner onboarding and payout accounts.' },
  { href: '/admin/stripe-readiness', label: 'Stripe readiness', blurb: 'Checkout and webhook configuration checks.' },
];

export default function AdminSectionNav() {
  const pathname = usePathname();

  return (
    <nav className="cinex-admin-nav" aria-label="Admin sections">
      {ADMIN_SECTIONS.map((section) => {
        const current = pathname === section.href;
        return (
          <Link
            key={section.href}
            href={section.href}
            className={current ? 'cinex-admin-nav-link is-current' : 'cinex-admin-nav-link'}
            aria-current={current ? 'page' : undefined}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
