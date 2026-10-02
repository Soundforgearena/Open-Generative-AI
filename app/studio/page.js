import { Suspense } from 'react';
import Studio from '@/components/studio/Studio';
import './studio.css';

export const metadata = {
  title: 'AI Video Creation Studio · CinexVideo',
  description: 'Direct, preview and generate every scene of your film, episode or music video.',
};

export default function StudioPage() {
  return (
    <Suspense fallback={<main className="sx-root sx-state"><span className="sx-spinner" aria-hidden="true" /></main>}>
      <Studio />
    </Suspense>
  );
}
