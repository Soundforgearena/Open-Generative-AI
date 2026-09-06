import Link from 'next/link';
import CinexNavigation from '@/components/CinexNavigation';

export default function CinexRoutePage({ eyebrow, title, description, children }) {
  return (
    <main className="cinex-page cinex-route-page">
      <div className="cinex-background" aria-hidden="true" />
      <div className="cinex-vignette" aria-hidden="true" />

      <CinexNavigation />
      <Link href="/" className="cinex-route-home">Home</Link>

      <section className="cinex-route-content" aria-labelledby="cinex-route-title">
        <p className="cinex-route-eyebrow">{eyebrow}</p>
        <h1 id="cinex-route-title">{title}</h1>
        <p className="cinex-route-description">{description}</p>
        {children}
        <Link href="/" className="cinex-route-back">Back to CineXVideo</Link>
      </section>
    </main>
  );
}