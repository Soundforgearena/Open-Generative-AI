'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function CinexNavigation({ showFeatures = false }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    if (!isMenuOpen) return undefined;

    function closeOnEscape(event) {
      if (event.key === 'Escape') setIsMenuOpen(false);
    }

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [isMenuOpen]);

  function closeMenu() {
    setIsMenuOpen(false);
  }

  return (
    <header className="cinex-header cinex-container">
      <Link href="/" className="cinex-home-mark" aria-label="CineXVideo home" onClick={closeMenu}>
        <img src="/favicon.jpg" alt="" aria-hidden="true" />
      </Link>
      <button
        type="button"
        className="cinex-menu-toggle"
        aria-expanded={isMenuOpen}
        aria-controls="cinex-primary-navigation"
        aria-label={isMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
        onClick={() => setIsMenuOpen((open) => !open)}
      >
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>
      <nav
        id="cinex-primary-navigation"
        className={`cinex-nav${isMenuOpen ? ' is-open' : ''}`}
        aria-label="Primary navigation"
      >
        <Link href="/create" onClick={closeMenu}>Create</Link>
        <Link href="/music-video" onClick={closeMenu}>Music Video</Link>
        {showFeatures && <a href="#features" onClick={closeMenu}>Features</a>}
        <Link href="/auth" onClick={closeMenu}>Sign in</Link>
      </nav>
    </header>
  );
}
