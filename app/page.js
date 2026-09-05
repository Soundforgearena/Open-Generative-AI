'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

const workflowOptions = [
  {
    title: 'Start with a Story',
    description: 'Turn your ideas into a cinematic video',
    icon: '✎',
    mode: 'story',
  },
  {
    title: 'Use My Script',
    description: 'Bring your script to life',
    icon: '▤',
    mode: 'script',
  },
  {
    title: 'Explore Templates',
    description: 'Discover cinematic templates',
    icon: '⌕',
    mode: 'templates',
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
  const router = useRouter();

  function beginCreation(mode = 'story') {
    router.push(`/create?mode=${mode}`);
  }

  return (
    <main className="cinex-page">
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

        <nav className="cinex-nav" aria-label="Primary navigation">
          <a href="#create">Create</a>
          <a href="#features">Features</a>
          <Link href="/auth">Sign in</Link>
        </nav>
      </header>

      <section className="cinex-hero" aria-labelledby="cinex-title">
        <div className="cinex-hero-content">
          <div className="cinex-logo-lockup">
            <img
              src="/favicon.jpg"
              alt="CineXVideo"
              className="cinex-main-mark"
            />
            <h1 id="cinex-title">
              CINE<span>X</span>VIDEO
            </h1>
          </div>

          <p className="cinex-tagline">Your story. Now in motion.</p>

          <div id="create" className="cinex-cta-wrap">
            <button
              type="button"
              className="cinex-primary-cta"
              onClick={() => beginCreation('story')}
            >
              <span className="clapper" aria-hidden="true">▰</span>
              Create a Video
            </button>
          </div>

          <div className="cinex-actions" aria-label="Choose how to begin">
            {workflowOptions.map((option) => (
              <button
                key={option.mode}
                type="button"
                className="cinex-action-card"
                onClick={() => beginCreation(option.mode)}
              >
                <span className="cinex-action-icon" aria-hidden="true">
                  {option.icon}
                </span>
                <span className="cinex-action-text">
                  <strong>{option.title}</strong>
                  <small>{option.description}</small>
                </span>
              </button>
            ))}
          </div>

          <div id="features" className="cinex-trust-row">
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
        </div>
      </section>
    </main>
  );
}