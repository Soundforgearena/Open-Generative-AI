import { redirect } from 'next/navigation';

// Operations (jobs, reservations, scheduler) live on the overview and cockpit.
export default function Page() {
  redirect('/admin');
}
