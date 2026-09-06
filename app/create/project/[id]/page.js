'use client';

import { useParams } from 'next/navigation';
import CinexRoutePage from '@/components/CinexRoutePage';
import DemoProjectEditor from '@/components/DemoProjectEditor';

export default function ProjectEditorPage() {
  const params = useParams();
  return (
    <CinexRoutePage
      eyebrow="Project editor"
      title="Shape every scene"
      description="Edit your local storyboard preview before any real generation is connected."
    >
      <DemoProjectEditor projectId={params.id} />
    </CinexRoutePage>
  );
}
