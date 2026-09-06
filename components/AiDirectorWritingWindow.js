'use client';

import { useEffect, useRef, useState } from 'react';

const PHRASES = {
  story: ['A lone traveler enters the wild…', 'The silence hides a secret…', 'The stakes rise with every step…', 'A choice changes everything.'],
  script: ['A pause reveals the truth…', 'The dialogue tightens…', 'The next beat shifts the scene…', 'The room holds its breath.'],
  visualNotes: ['Moonlit haze and deep shadows…', 'Slow camera movement builds tension…', 'Gold light cuts through the storm…', 'The frame finds its emotional center.'],
  default: ['Finding the emotional core…', 'A character wants something…', 'The scene gathers pressure…', 'A cinematic choice takes shape.'],
};

const STAGES = ['Reading your notes', 'Finding the emotional core', 'Shaping the cinematic direction', 'Drafting your suggestion'];

export default function AiDirectorWritingWindow({ isOpen, isGenerating, fieldType, sourceText, genre, visualStyle, onCancel, onSkip, onComplete, isDemoMode }) {
  const closeRef = useRef(null);
  const previousFocus = useRef(null);
  const [stage, setStage] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const phrases = PHRASES[fieldType] || PHRASES.default;

  useEffect(() => {
    if (!isOpen || !isGenerating) return undefined;
    previousFocus.current = document.activeElement;
    closeRef.current?.focus();
    setStage(0);
    const interval = window.setInterval(() => setStage((current) => Math.min(current + 1, STAGES.length - 1)), 650);
    const timer = window.setTimeout(() => onComplete?.(), 2200);
    function handleKey(event) {
      if (event.key === 'Escape') onCancel?.();
      if (event.key === 'Tab') {
        const panel = closeRef.current?.closest('[role="dialog"]');
        const focusable = panel?.querySelectorAll('button:not([disabled])');
        if (!focusable?.length) return;
        if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
        else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0].focus(); }
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timer);
      document.removeEventListener('keydown', handleKey);
      previousFocus.current?.focus?.();
    };
  }, [isOpen, isGenerating, onCancel, onComplete]);

  if (!isOpen || !isGenerating) return null;

  return (
    <div className="cinex-writing-backdrop" role="presentation">
      <section className="cinex-writing-window" role="dialog" aria-modal="true" aria-labelledby="writing-window-title">
        <div className="cinex-writing-copy">
          <div className="cinex-writing-heading">
            <div>
              <p className="cinex-shot-plan-eyebrow">AI Director</p>
              <h2 id="writing-window-title">AI DIRECTOR IS WRITING</h2>
              <p>{isDemoMode ? 'Demo Director preview — shaping a local writing suggestion.' : 'The Director is shaping a creative draft from your notes.'}</p>
            </div>
            <button ref={closeRef} type="button" className="cinex-director-close" onClick={onCancel} aria-label="Cancel Director writing">×</button>
          </div>
          <div className="cinex-writing-bubbles" aria-live="polite">
            {phrases.map((phrase, index) => <span className={`cinex-writing-bubble bubble-${index}`} key={phrase}>{phrase}</span>)}
          </div>
          <p className="cinex-writing-stage">{STAGES[stage]} <span className="cinex-writing-dots" aria-hidden="true">•••</span></p>
          <div className="cinex-writing-progress" aria-label={`${STAGES[stage]}, stage ${stage + 1} of ${STAGES.length}`}><span style={{ width: `${((stage + 1) / STAGES.length) * 100}%` }} /></div>
          <div className="cinex-writing-controls">
            <button type="button" className="cinex-auth-secondary" onClick={onSkip}>Skip animation</button>
            <button type="button" className="cinex-auth-secondary" onClick={onCancel}>Cancel</button>
          </div>
        </div>
        <div className={`cinex-writing-art ${imageFailed ? 'is-fallback' : ''}`} aria-hidden="true">
          {!imageFailed && <img src="/images/ai-director-fairy-writing-room.png" alt="" onError={() => setImageFailed(true)} />}
          {imageFailed && <span className="cinex-writing-fallback">✦</span>}
        </div>
      </section>
    </div>
  );
}
