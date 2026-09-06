 'use client';

import { useEffect, useState } from 'react';
import CinexRoutePage from '@/components/CinexRoutePage';
import CinexWorkflowForm from '@/components/CinexWorkflowForm';

export default function ScriptPage() {
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
      <CinexWorkflowForm mode="script" template={template} />
    </CinexRoutePage>
  );
}