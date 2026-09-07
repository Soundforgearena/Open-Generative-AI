import Link from 'next/link';
import CinexNavigation from '@/components/CinexNavigation';
import AdminSectionNav from '@/components/admin/AdminSectionNav';
import { requireAdmin } from '@/lib/admin/authorize';

/**
 * Shared shell for every /admin route.
 *
 * The shared layout enforces server-side authorisation before any admin section
 * renders, and supplies the chrome that previously made the area unreachable.
 */
export default async function AdminLayout({ children }) {
  await requireAdmin('/admin');

  return (
    <main className="cinex-page cinex-admin-page">
      <div className="cinex-background" aria-hidden="true" />
      <div className="cinex-vignette" aria-hidden="true" />

      <CinexNavigation />

      <section className="cinex-admin-shell">
        <header className="cinex-admin-header">
          <p className="cinex-route-eyebrow">Administration</p>
          <AdminSectionNav />
        </header>

        {children}

        <Link href="/dashboard" className="cinex-route-back">Back to your dashboard</Link>
      </section>
    </main>
  );
}
