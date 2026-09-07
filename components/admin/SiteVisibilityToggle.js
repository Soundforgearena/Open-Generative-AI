'use client';

import { useEffect, useState } from 'react';
import { getAdminSummary, runAdminAction } from '@/lib/cinexvideo-client';

/**
 * Site visibility switch.
 *
 * While this is set to "Team only", every visitor who is not an admin is sent
 * to the under-construction page. Admins always get the real site so the studio
 * can be built and tested against production. Flip it to "Open to everyone"
 * when you are ready to launch — no redeploy needed.
 */
export default function SiteVisibilityToggle() {
  const [enabled, setEnabled] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    getAdminSummary()
      .then((data) => setEnabled(Boolean(data?.controls?.maintenance_enabled)))
      .catch((error) => setStatus(error.message || 'Site visibility could not be loaded.'));
  }, []);

  async function toggle() {
    const next = !enabled;
    setBusy(true);
    setStatus('');
    try {
      await runAdminAction({ action: 'set_maintenance', enabled: next });
      setEnabled(next);
      setStatus(
        next
          ? 'The site is now visible to admins only. Visitors see the under-construction page.'
          : 'The site is now open to everyone.'
      );
    } catch (error) {
      setStatus(error.message || 'Site visibility could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  const live = enabled === false;

  return (
    <section className="cinex-visibility-card" aria-labelledby="site-visibility-title">
      <div className="cinex-visibility-copy">
        <h2 id="site-visibility-title">Site visibility</h2>
        {enabled === null ? (
          <p>Checking who can currently see the site...</p>
        ) : (
          <p>
            {live
              ? 'The site is open to everyone. Anyone can sign up, create and buy credits.'
              : 'The site is in build mode. Everyone except admins is sent to the under-construction page.'}
          </p>
        )}
      </div>

      <div className="cinex-visibility-control">
        <span className={live ? 'cinex-visibility-state is-live' : 'cinex-visibility-state'}>
          {enabled === null ? '—' : live ? 'Open to everyone' : 'Team only'}
        </span>
        <button
          type="button"
          className={live ? 'cinex-route-secondary' : 'cinex-route-primary'}
          onClick={toggle}
          disabled={busy || enabled === null}
          aria-pressed={live}
        >
          {busy ? 'Saving...' : live ? 'Switch to team only' : 'Open the site to everyone'}
        </button>
      </div>

      {status && <p className="cinex-visibility-status" role="status">{status}</p>}
    </section>
  );
}
