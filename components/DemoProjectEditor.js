'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getDemoProject, saveDemoProject } from '@/lib/demo-project-store';
import { demoModeEnabled } from '@/lib/demo-mode';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { storeSession } from '@/lib/cinexvideo-client';
import { StoryboardPreview } from './DemoProjectBuilder';

export default function DemoProjectEditor({ projectId }) {
  const [project, setProject] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(demoModeEnabled);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadEditor() {
      if (demoModeEnabled) {
        setProject(getDemoProject(projectId));
        return;
      }

      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      if (!cancelled && data.session) {
        storeSession(data.session);
        setAuthenticated(true);
      }
      if (!cancelled) setSessionChecked(true);
    }

    loadEditor().catch(() => {
      if (!cancelled) setSessionChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!sessionChecked) {
    return <div className="cinex-auth-required">Checking your account...</div>;
  }
  if (!demoModeEnabled && !authenticated) {
    return <div className="cinex-auth-required">Sign in with Google to open project editors.</div>;
  }
  if (!demoModeEnabled) {
    return <div className="cinex-auth-required">This editor is available for local demo projects only. Production project editing is not connected to this route yet.</div>;
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
