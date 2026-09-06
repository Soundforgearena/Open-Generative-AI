'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import CinexRoutePage from '@/components/CinexRoutePage';
import { demoModeEnabled } from '@/lib/demo-mode';
import { getDemoProject } from '@/lib/demo-project-store';
import { safeProjectId } from '@/lib/safe-navigation';

function CompletedContent() {
  const params = useParams();
  const [project, setProject] = useState(null);

  useEffect(() => {
    if (demoModeEnabled && safeProjectId(params.id, true)) setProject(getDemoProject(params.id));
  }, [params.id]);

  return (
    <CinexRoutePage
      eyebrow="Demo project"
      title="Completed storyboard"
      description="Storyboard simulation complete. Connect your account to generate a video."
    >
      {project ? (
        <section className="cinex-shot-plan" aria-labelledby="completed-project-title">
          <p className="cinex-shot-plan-eyebrow">Demo preview — no video was generated and no credits were used.</p>
          <h2 id="completed-project-title">{project.title}</h2>
          <p className="cinex-shot-plan-logline">{project.sourceText}</p>
          <div className="cinex-scene-list">
            {project.scenes.map((scene) => (
              <article className="cinex-scene-card" key={scene.id}>
                <div className="cinex-scene-card-header"><strong>Scene {scene.sceneNumber}</strong><span>Completed · {scene.estimatedDurationSeconds || scene.estimatedDuration}s</span></div>
                <p><strong>{scene.title}</strong></p>
                <p>{scene.summary}</p>
              </article>
            ))}
          </div>
          <div className="cinex-dashboard-actions">
            <Link href={`/create/review?project=${encodeURIComponent(project.id)}`} className="cinex-route-primary">Edit storyboard</Link>
            <Link href="/create" className="cinex-auth-secondary">Create another project</Link>
            <Link href="/dashboard" className="cinex-route-secondary-link">Go to Dashboard</Link>
          </div>
        </section>
      ) : (
        <div className="cinex-missing-draft">
          <p className="cinex-form-error">We couldn&apos;t find that completed project.</p>
          <Link href="/dashboard" className="cinex-route-primary">Go to Dashboard</Link>
        </div>
      )}
    </CinexRoutePage>
  );
}

export default function CompletedProjectPage() {
  return <Suspense fallback={<main className="cinex-dashboard-loading">Loading completed project...</main>}><CompletedContent /></Suspense>;
}