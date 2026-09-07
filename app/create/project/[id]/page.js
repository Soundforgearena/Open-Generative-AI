'use client';

import { useParams } from 'next/navigation';
import CinexRoutePage from '@/components/CinexRoutePage';
import DemoProjectEditor from '@/components/DemoProjectEditor';
import ProductionProjectEditor from '@/components/ProductionProjectEditor';
import { demoModeEnabled } from '@/lib/demo-mode';

export default function ProjectEditorPage() {
  const params = useParams();
  return (
    <CinexRoutePage
      eyebrow="Project editor"
      title="Shape every scene"
      description={demoModeEnabled
        ? 'Edit your local storyboard preview before any real generation is connected.'
        : 'Edit your saved production storyboard and scene direction.'}
    >
      {demoModeEnabled ? <DemoProjectEditor projectId={params.id} /> : <ProductionProjectEditor projectId={params.id} />}
    </CinexRoutePage>
  );
}
