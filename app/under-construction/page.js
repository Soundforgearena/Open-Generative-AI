import Link from 'next/link';

export const metadata = {
  title: 'CineXVideo — Under construction',
  description: 'CineXVideo is building a cinematic AI creation studio.',
};

export default function UnderConstructionPage() {
  return (
    <main className="cinex-maintenance-page">
      <div className="cinex-maintenance-glow" aria-hidden="true" />
      <section className="cinex-maintenance-panel" aria-labelledby="maintenance-title">
        <p className="cinex-maintenance-brand">CINEXVIDEO</p>
        <div className="cinex-maintenance-rule" aria-hidden="true" />
        <h1 id="maintenance-title">Under construction</h1>
        <p className="cinex-maintenance-message">
          We&apos;re building a cinematic AI creation studio.<br />
          Please check back soon.
        </p>
        <Link href="/privacy" className="cinex-maintenance-link">Privacy</Link>
      </section>
    </main>
  );
}