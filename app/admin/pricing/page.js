import { redirect } from 'next/navigation';

// The pricing catalog and credit packs live on the overview page.
export default function Page() {
  redirect('/admin');
}
