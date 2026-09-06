import CinexRoutePage from '@/components/CinexRoutePage';
import Link from 'next/link';

const templates = [
  ['Midnight Signal', 'Tense sci-fi mystery with cool neon light.', 'Sci-fi mystery'],
  ['Golden Hour', 'Warm, intimate portrait built for emotional stories.', 'Emotional drama'],
  ['Pulse City', 'Rhythm-led urban montage for music and movement.', 'Music video'],
];

export default function TemplatesPage() {
  return (
    <CinexRoutePage
      eyebrow="CineXVideo library"
      title="Explore templates"
      description="Browse cinematic starting points for stories, music videos, episodes, and branded scenes."
    >
      <div className="cinex-template-grid">
        {templates.map(([name, description, category]) => (
          <Link
            key={name}
            href={`/create?template=${encodeURIComponent(name)}`}
            className="cinex-template-card"
          >
            <span>{category}</span>
            <strong>{name}</strong>
            <small>{description}</small>
            <em>Use template</em>
          </Link>
        ))}
      </div>
    </CinexRoutePage>
  );
}