 'use client';
import { demoModeEnabled } from '@/lib/demo-mode';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import CinexRoutePage from '@/components/CinexRoutePage';
import DemoProjectBuilder from '@/components/DemoProjectBuilder';

export default function ScriptPage() {
  const router = useRouter();
  const [template, setTemplate] = useState('');

  useEffect(() => {
    setTemplate(new URLSearchParams(window.location.search).get('template') || '');
  }, []);

  return (
    <CinexRoutePage
      eyebrow="Script to screen"
      title="Use my script"
      description="Bring your existing script into a focused cinematic workflow for planning and production."
    >
      <DemoProjectBuilder sourceType="script" template={template ? { title: template, starterPrompt: '', category: 'Cinematic' } : null} onCreated={(id) => router.push(demoModeEnabled ? `/create/review?project=${encodeURIComponent(id)}` : `/studio?project=${encodeURIComponent(id)}&welcome=1`)} />
    </CinexRoutePage>
  );
}