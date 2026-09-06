import Link from 'next/link';

export default function CinexRoutePage({ eyebrow, title, description, children }) {
  return (
    <main className="cinex-page cinex-route-page">
      <div className="cinex-background" aria-hidden="true" />
      <div className="cinex-vignette" aria-hidden="true" />

      <header className="cinex-header">
        <Link href="/" className="cinex-brand" aria-label="CineXVideo home">
          <img
            src="/favicon.jpg"
            alt=""
            className="cinex-brand-mark"
            aria-hidden="true"
          />
          <span>CineX<span>Video</span></span>
        </Link>
        <Link href="/" className="cinex-route-home">Home</Link>
      </header>

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