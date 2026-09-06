'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import CinexRoutePage from '@/components/CinexRoutePage';

export default function CreatePage() {
  const [template, setTemplate] = useState('');
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const selected = new URLSearchParams(window.location.search).get('template');
    setTemplate(selected || '');
    setDraft(new URLSearchParams(window.location.search).get('draft') || '');
  }, []);

  const templateQuery = template ? `?template=${encodeURIComponent(template)}` : '';

  return (
    <CinexRoutePage
      eyebrow="CineXVideo production desk"
      title="Create a video"
      description="Choose the starting point that best fits the story you want to bring to life."
    >
      {template && (
        <p className="cinex-selection-note">
          Starting with template: <strong>{template}</strong>
        </p>
      )}
      {draft && (
        <p className="cinex-selection-note">
          Draft ready to continue: <strong>{draft}</strong>
        </p>
      )}
      <div className="cinex-route-actions">
        <Link href={`/create/story${templateQuery}`} className="cinex-route-option">
          <strong>Start with a story</strong>
          <span>Shape an idea into a cinematic sequence.</span>
        </Link>
        <Link href={`/create/script${templateQuery}`} className="cinex-route-option">
          <strong>Use my script</strong>
          <span>Build from dialogue, scenes, and direction.</span>
        </Link>
      </div>
      <Link href="/templates" className="cinex-route-secondary-link">Choose a different template</Link>
    </CinexRoutePage>
  );
}