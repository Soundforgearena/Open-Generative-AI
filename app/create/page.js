import Link from 'next/link';
import CinexRoutePage from '@/components/CinexRoutePage';

export default function CreatePage() {
  return (
    <CinexRoutePage
      eyebrow="CineXVideo production desk"
      title="Create a video"
      description="Choose the starting point that best fits the story you want to bring to life."
    >
      <div className="cinex-route-actions">
        <Link href="/create/story" className="cinex-route-option">
          <strong>Start with a story</strong>
          <span>Shape an idea into a cinematic sequence.</span>
        </Link>
        <Link href="/create/script" className="cinex-route-option">
          <strong>Use my script</strong>
          <span>Build from dialogue, scenes, and direction.</span>
        </Link>
      </div>
    </CinexRoutePage>
  );
}