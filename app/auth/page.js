import Link from 'next/link';
import CinexRoutePage from '@/components/CinexRoutePage';

export default function AuthPage() {
  return (
    <CinexRoutePage
      eyebrow="Your CineXVideo workspace"
      title="Sign in"
      description="Sign in to continue creating and keep your projects together in one place."
    >
      <Link href="/auth/callback" className="cinex-route-primary">
        Continue to sign in
      </Link>
    </CinexRoutePage>
  );
}