import CinexRoutePage from '@/components/CinexRoutePage';
import Link from 'next/link';
import { DEMO_TEMPLATES } from '@/lib/demo-templates';

export default function TemplatesPage() {
  return (
    <CinexRoutePage
      eyebrow="CineXVideo library"
      title="Explore templates"
      description="Browse cinematic starting points for stories, music videos, episodes, and branded scenes."
    >
      <div className="cinex-template-grid">
        {DEMO_TEMPLATES.map((template) => (
          <Link
            key={template.slug}
            href={`/create?template=${template.slug}`}
            className="cinex-template-card"
          >
            <span>{template.category} · {template.aspectRatio}</span>
            <strong>{template.title}</strong>
            <small>{template.description}</small>
            <small>{template.sceneCount} starter scenes</small>
            <em>Use template</em>
          </Link>
        ))}
      </div>
    </CinexRoutePage>
  );
}