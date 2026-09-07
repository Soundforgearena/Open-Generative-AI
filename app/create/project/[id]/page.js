'use client';

import { useParams } from 'next/navigation';
import CinexRoutePage from '@/components/CinexRoutePage';
import DemoProjectEditor from '@/components/DemoProjectEditor';
import ProductionProjectEditor from '@/components/ProductionProjectEditor';
import { demoModeEnabled } from '@/lib/demo-mode';
import { safeProjectId } from '@/lib/safe-navigation';

export default function ProjectEditorPage() {
  const params = useParams();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  return (
    <CinexRoutePage
      eyebrow="Project editor"
      title="Shape every scene"
      description={demoModeEnabled
        ? 'Edit your local storyboard preview before any real generation is connected.'
        : 'Edit your saved production storyboard and scene direction.'}
    >
      {!safeProjectId(projectId, demoModeEnabled) ? (
        <p className="cinex-form-error" role="alert">That project link is invalid.</p>
      ) : demoModeEnabled ? (
        <DemoProjectEditor projectId={projectId} />
      ) : (
        <ProductionProjectEditor projectId={projectId} />
      )}
    </CinexRoutePage>
  );
}
