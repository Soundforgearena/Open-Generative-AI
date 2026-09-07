'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ADMIN_SECTIONS } from '@/lib/admin/sections';

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
