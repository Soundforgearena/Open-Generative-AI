import { requireAdmin } from '@/lib/admin/authorize';
import R2StorageSettings from '@/components/admin/R2StorageSettings';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  await requireAdmin('/admin/settings');
  return <div className="cinex-admin-overview"><h1>Admin settings</h1><R2StorageSettings /></div>;
}
