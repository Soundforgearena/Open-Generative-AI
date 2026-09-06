'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import CinexRoutePage from '@/components/CinexRoutePage';
import { getStoredSession } from '@/lib/cinexvideo-client';

const DRAFT_KEYS = ['cinexvideo_draft_story', 'cinexvideo_draft_script'];

export default function DashboardPage() {
  const router = useRouter();
  const [drafts, setDrafts] = useState([]);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!getStoredSession()?.access_token) {
      router.replace('/auth?next=/dashboard');
      return;
    }

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
  }, [router]);

  if (checking) {
    return <main className="cinex-dashboard-loading">Checking your session...</main>;
  }

  return (
    <CinexRoutePage
      eyebrow="Creator dashboard"
      title="Your projects"
      description="Continue a local draft or start a new cinematic project. Generation requires an authenticated, configured account."
    >
      <div className="cinex-dashboard-actions">
        <Link href="/create" className="cinex-route-primary">Start a project</Link>
        <Link href="/auth?next=/dashboard" className="cinex-route-secondary-link">Account and billing</Link>
      </div>

      <section className="cinex-dashboard-projects" aria-labelledby="recent-projects-title">
        <h2 id="recent-projects-title">Recent local drafts</h2>
        {drafts.length ? (
          <div className="cinex-dashboard-list">
            {drafts.map((draft) => (
              <Link key={draft.key} href={`/create/${draft.mode}`} className="cinex-dashboard-draft">
                <strong>{draft.idea || draft.script?.slice(0, 80) || 'Untitled project'}</strong>
                <span>{draft.mode === 'story' ? 'Story brief' : 'Script draft'} · {draft.duration} seconds</span>
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