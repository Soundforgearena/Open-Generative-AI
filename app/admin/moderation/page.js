import { requireSuperAdmin } from '@/lib/admin/authorize';
import ModerationQueue from '@/components/admin/ModerationQueue';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireSuperAdmin('/admin/moderation');
  return <ModerationQueue />;
}
