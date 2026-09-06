'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import CinexRoutePage from '@/components/CinexRoutePage';
import DemoProjectBuilder from '@/components/DemoProjectBuilder';
import { demoModeEnabled } from '@/lib/demo-mode';
import { listDemoProjects } from '@/lib/demo-project-store';
import { DEMO_TEMPLATES } from '@/lib/demo-templates';

export default function CreatePage() {
  const [template, setTemplate] = useState(null);
  const [sourceType, setSourceType] = useState('idea');
  const [recentProjects, setRecentProjects] = useState([]);

  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get('template');
    const selectedTemplate = DEMO_TEMPLATES.find((item) => item.slug === slug) || null;
    setTemplate(selectedTemplate);
    if (selectedTemplate) setSourceType('template');
    if (demoModeEnabled) setRecentProjects(listDemoProjects().slice(0, 3));
  }, []);

  return (
    <CinexRoutePage
      eyebrow="CineXVideo production desk"
      title="Start a project"
      description="Build a local storyboard preview safely while connected generation remains separate."
    >
      {demoModeEnabled && <p className="cinex-demo-indicator">Demo mode — local data only</p>}
      <div className="cinex-create-tabs" role="tablist" aria-label="Project source type">
        {[
          ['idea', 'Start with an idea'],
          ['story', 'Start with a story'],
          ['script', 'Start with a script'],
        ].map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={sourceType === value} className={sourceType === value ? 'is-selected' : ''} onClick={() => setSourceType(value)}>{label}</button>
        ))}
        <Link href="/templates" className="cinex-create-tab-link">Start from a template</Link>
      </div>
      {template && <p className="cinex-selection-note">Starting from <strong>{template.title}</strong></p>}
      <DemoProjectBuilder sourceType={sourceType} template={template} />
      {demoModeEnabled && recentProjects.length > 0 && (
        <section className="cinex-recent-demo-projects" aria-labelledby="recent-demo-title">
          <h2 id="recent-demo-title">Recent demo projects</h2>
          {recentProjects.map((project) => (
            <Link key={project.id} href={`/create/review?project=${encodeURIComponent(project.id)}`} className="cinex-dashboard-draft">
              <strong>{project.title}</strong>
              <span>{project.status} · {project.scenes.length} scenes</span>
            </Link>
          ))}
        </section>
      )}
    </CinexRoutePage>
  );
}
