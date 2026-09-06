'use client';

import Link from 'next/link';

const workflowOptions = [
  {
    title: 'Start with a Story',
    description: 'Turn your ideas into a cinematic video',
    icon: '✎',
    href: '/create/story',
  },
  {
    title: 'Use My Script',
    description: 'Bring your script to life',
    icon: '▤',
    href: '/create/script',
  },
  {
    title: 'Explore Templates',
    description: 'Discover cinematic templates',
    icon: '⌕',
    href: '/templates',
  },
];

const trustPoints = [
  ['▦', 'Cinematic quality'],
  ['ϟ', 'AI-powered tools'],
  ['♫', 'Sound & music'],
  ['☁', 'Cloud storage'],
  ['▣', 'Any device'],
  ['♢', 'Secure & private'],
];

export default function HomePage() {
  return (
    <main className="cinex-page">
      <header className="cinex-header cinex-container">
        <Link href="/" className="cinex-home-mark" aria-label="CineXVideo home">
          <img src="/favicon.jpg" alt="" aria-hidden="true" />
        </Link>
        <nav className="cinex-nav" aria-label="Primary navigation">
          <Link href="/create">Create</Link>
          <a href="#features">Features</a>
          <Link href="/auth">Sign in</Link>
        </nav>
      </header>

      <section className="cinex-hero cinex-container" aria-labelledby="cinex-title">
        <h1 id="cinex-title" className="cinex-sr-only">CineXVideo</h1>
        <div
          className="cinex-hero-art"
          role="img"
          aria-label="Cinematic worlds brought to life with CineXVideo"
        />
        <div id="create" className="cinex-cta-wrap">
            <Link href="/create" className="cinex-primary-cta">
              <span className="clapper" aria-hidden="true">▰</span>
              Create a Video
            </Link>
        </div>
      </section>

      <section className="cinex-secondary cinex-container" aria-labelledby="cinex-options-title">
        <h2 id="cinex-options-title">Choose your starting point</h2>
        <div className="cinex-actions" aria-label="Choose how to begin">
          {workflowOptions.map((option) => (
            <Link key={option.href} href={option.href} className="cinex-action-card">
              <span className="cinex-action-icon" aria-hidden="true">
                {option.icon}
              </span>
              <span className="cinex-action-text">
                <strong>{option.title}</strong>
                <small>{option.description}</small>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section id="features" className="cinex-features cinex-container" aria-label="CineXVideo features">
        <div className="cinex-trust-row">
          {trustPoints.map(([icon, label]) => (
            <span key={label} className="cinex-trust-item">
              <span aria-hidden="true">{icon}</span>
              {label}
            </span>
          ))}
        </div>
        <p className="cinex-footer-line">
          Made for <span>creators</span>. Built for <span>impact</span>.
        </p>
      </section>
    </main>
  );
}