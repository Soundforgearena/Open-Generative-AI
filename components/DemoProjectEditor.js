'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getDemoProject, saveDemoProject } from '@/lib/demo-project-store';
import { demoModeEnabled } from '@/lib/demo-mode';
import { StoryboardPreview } from './DemoProjectBuilder';

export default function DemoProjectEditor({ projectId }) {
  const [project, setProject] = useState(null);

  useEffect(() => {
    if (demoModeEnabled) setProject(getDemoProject(projectId));
  }, [projectId]);

  if (!demoModeEnabled) {
    return <div className="cinex-auth-required">Demo mode is disabled. Connect an authenticated account to open project editors.</div>;
  }
  if (!project) {
    return <div className="cinex-form-error">This local demo project could not be found. <Link href="/dashboard">Return to dashboard</Link></div>;
  }

  return (
    <div className="cinex-editor-wrap">
      <label className="cinex-editor-title">
        Project title
        <input value={project.title} onChange={(event) => {
          const next = { ...project, title: event.target.value };
          setProject(next);
          saveDemoProject(next);
        }} />
      </label>
      <StoryboardPreview project={project} onSave={setProject} />
    </div>
  );
}
