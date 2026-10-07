import { requireAdmin } from '@/lib/admin/authorize';
import AdminUsers from '@/components/admin/AdminUsers';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  await requireAdmin('/admin/users');
  return (
    <div className="cinex-admin-overview">
      <h1>Users and credits</h1>
      <p className="cinex-route-description">Find accounts, see credit balances and suspend or reactivate members.</p>
      <AdminUsers />
    </div>
  );
}
