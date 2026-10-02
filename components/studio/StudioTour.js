'use client';

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

export const TOUR_KEY = 'cinex-studio-tour-v1';

const STEPS = [
  { target: null, title: 'Welcome to your studio', body: 'This is where your film comes to life. A 40-second tour, then the camera is yours.' },
  { target: 'scenes', title: 'Your scenes', body: 'Every beat of your story. Click one to direct it, drag to reorder, or add new scenes at the bottom.' },
  { target: 'prompt', title: 'Describe the shot', body: 'Write what the camera sees, or press Director and let the AI Director write it for you, free.' },
  { target: 'shot', title: 'Call the camera', body: 'Shot type, movement, angle and lens become real camera language in your generation.' },
  { target: 'inspector', title: 'Fine-tune everything', body: 'Visual style, continuity between scenes, your soundtrack, and generation settings live here.' },
  { target: 'flight', title: "Director's Flight Path", body: 'See the whole film at a glance. Green is locked, amber needs review, red needs attention. Click anywhere to jump there.' },
  { target: 'generate', title: 'Roll camera', body: 'Generate shows the exact credit total before anything is spent. Nothing is charged without your confirmation.' },
];

function rectFor(target) {
  if (!target) return null;
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export default function StudioTour({ open, onClose }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);
  const current = STEPS[step];

  const measure = useCallback(() => {
    const el = current.target && document.querySelector(`[data-tour="${current.target}"]`);
    if (el && window.innerWidth < 1200) el.scrollIntoView({ block: 'center', behavior: 'instant' in window ? 'instant' : 'auto' });
    setRect(rectFor(current.target));
  }, [current.target]);

  useLayoutEffect(() => { if (open) measure(); }, [open, measure]);
  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [open, measure]);
  useEffect(() => { if (open) setStep(0); }, [open]);

  const finish = useCallback(() => {
    try { window.localStorage.setItem(TOUR_KEY, 'done'); } catch { /* private mode */ }
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); if (step < STEPS.length - 1) setStep(step + 1); else finish(); }
      if (e.key === 'ArrowLeft' && step > 0) setStep(step - 1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, step, finish]);

  if (!open) return null;

  const pad = 8;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const cardW = Math.min(340, vw - 24);
  let cardStyle = { width: cardW, left: (vw - cardW) / 2, top: vh / 2 - 110 };
  if (rect) {
    const below = rect.top + rect.height + pad + 14;
    const spaceBelow = vh - below;
    const top = spaceBelow > 210 ? below : Math.max(12, rect.top - pad - 14 - 200);
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - cardW / 2), vw - cardW - 12);
    cardStyle = { width: cardW, left, top: rect.height > vh * 0.6 ? Math.max(12, rect.top + 24) : top };
    if (rect.width > vw * 0.5 && rect.height > vh * 0.5) cardStyle.left = Math.min(rect.left + rect.width - cardW - 24, vw - cardW - 12);
  }

  return (
    <div className="sx-tour" role="dialog" aria-modal="true" aria-labelledby="sx-tour-title">
      {rect ? (
        <div className="sx-tour-spot" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      ) : <div className="sx-tour-dim" />}
      <div className="sx-tour-card" style={cardStyle}>
        <p className="sx-kicker">Step {step + 1} of {STEPS.length}</p>
        <h2 id="sx-tour-title">{current.title}</h2>
        <p>{current.body}</p>
        <div className="sx-tour-dots" aria-hidden="true">{STEPS.map((_, i) => <i key={i} className={i === step ? 'is-on' : ''} />)}</div>
        <div className="sx-tour-actions">
          <button type="button" className="sx-link-btn sx-tour-skip" onClick={finish}>Skip tour</button>
          {step > 0 && <button type="button" className="sx-btn sx-btn-sm" onClick={() => setStep(step - 1)}>Back</button>}
          <button type="button" className="sx-btn sx-btn-gold sx-btn-sm" autoFocus onClick={() => (step < STEPS.length - 1 ? setStep(step + 1) : finish())}>
            {step === 0 ? 'Show me' : step < STEPS.length - 1 ? 'Next' : 'Start directing'}
          </button>
        </div>
      </div>
    </div>
  );
}

export const SHORTCUTS = [
  ['Space', 'Play / pause'],
  ['← →', 'Previous / next scene'],
  ['P', 'Preview the whole film'],
  ['G', 'Generate (always asks first)'],
  ['D', 'Open the AI Director'],
  ['N', 'Add a scene after this one'],
  ['?', 'Show this help'],
];
