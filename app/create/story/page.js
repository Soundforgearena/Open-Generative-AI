 'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import CinexRoutePage from '@/components/CinexRoutePage';
import DemoProjectBuilder from '@/components/DemoProjectBuilder';

export default function StoryPage() {
  const router = useRouter();
  const [template, setTemplate] = useState('');

  useEffect(() => {
    setTemplate(new URLSearchParams(window.location.search).get('template') || '');
  }, []);

  return (
    <CinexRoutePage
      eyebrow="Story to screen"
      title="Start with a story"
      description="Give your idea a cinematic shape with scenes, mood, and motion ready for the next step."
    >
      <DemoProjectBuilder sourceType="story" template={template ? { title: template, starterPrompt: '', category: 'Cinematic' } : null} onCreated={(id) => router.push(`/create/review?project=${encodeURIComponent(id)}`)} />
    </CinexRoutePage>
  );
}