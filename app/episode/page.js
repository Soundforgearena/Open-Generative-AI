import Link from 'next/link';

export default function EpisodePage() {
  return (
    <main className="cinex-route-page">
      <section className="cinex-route-card">
        <p className="cinex-route-eyebrow">Cinex Episode Studio</p>
        <h1>Episode Studio</h1>
        <p>Build premise, screenplay, continuity bible, and shot plan before any generation run.</p>
        <div className="cinex-dashboard-actions">
          <Link href="/episode/director" className="cinex-route-primary">Open Episode Director</Link>
          <Link href="/dashboard" className="cinex-route-secondary-link">Back to dashboard</Link>
        </div>
      </section>
    </main>
  );
}
