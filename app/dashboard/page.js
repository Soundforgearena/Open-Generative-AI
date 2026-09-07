'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import CinexRoutePage from '@/components/CinexRoutePage';
import { storeSession } from '@/lib/cinexvideo-client';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { demoModeEnabled } from '@/lib/demo-mode';
import { listDemoProjects, resetDemoProjects } from '@/lib/demo-project-store';

const DRAFT_KEYS = ['cinexvideo_draft_story', 'cinexvideo_draft_script'];

export default function DashboardPage() {
  const router = useRouter();
  const [drafts, setDrafts] = useState([]);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function loadDashboard() {
      if (demoModeEnabled) {
        setDrafts(listDemoProjects());
        setChecking(false);
        return;
      }
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.replace('/auth?next=/dashboard');
        return;
      }
      storeSession(data.session);

      const localDrafts = DRAFT_KEYS.flatMap((key) => {
        try {
          const draft = JSON.parse(window.localStorage.getItem(key) || 'null');
          return draft ? [{ ...draft, key }] : [];
        } catch {
          return [];
        }
      });
      setDrafts(localDrafts);
      setChecking(false);
    }

    loadDashboard().catch(() => {
      router.replace('/auth?next=/dashboard');
    });
  }, [router]);

  if (checking) {
    return <main className="cinex-dashboard-loading">Checking your session...</main>;
  }

  function resetDemoData() {
    if (!window.confirm('Reset all local demo projects and scenes? This cannot be undone.')) return;
    resetDemoProjects();
    setDrafts([]);
  }

  return (
    <CinexRoutePage
      eyebrow="Creator dashboard"
      title="Your projects"
      description="Continue a local draft or start a new cinematic project. Generation requires an authenticated, configured account."
    >
      {demoModeEnabled && <p className="cinex-demo-indicator">Demo mode — local data only</p>}
      <div className="cinex-dashboard-actions">
        <Link href="/create" className="cinex-route-primary">Start a project</Link>
        {!demoModeEnabled && <Link href="/auth?next=/dashboard" className="cinex-route-secondary-link">Account and billing</Link>}
        {demoModeEnabled && <button type="button" className="cinex-auth-secondary" onClick={resetDemoData}>Reset demo data</button>}
      </div>

      <section className="cinex-dashboard-projects" aria-labelledby="recent-projects-title">
        <h2 id="recent-projects-title">Recent local drafts</h2>
        {drafts.length ? (
          <div className="cinex-dashboard-list">
            {drafts.map((draft) => (
              <Link key={draft.id || draft.key} href={`/create/project/${draft.id}`} className="cinex-dashboard-draft">
                <strong>{draft.title || 'Untitled project'}</strong>
                <span>{draft.status || 'Draft'} · {draft.sourceType || draft.mode} · {draft.duration} seconds</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="cinex-dashboard-empty">No local drafts yet. Your first project will appear here.</p>
        )}
      </section>
    </CinexRoutePage>
  );
}