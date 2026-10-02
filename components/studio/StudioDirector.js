'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './StudioIcons';
import { requestDirectorAssist } from '@/lib/cinexvideo-client';
import { demoModeEnabled } from '@/lib/demo-mode';

const ACTIONS = [
  { id: 'cinematicPrompt', label: 'Write this shot for me', hint: 'A production-ready prompt from your scene', empty: true },
  { id: 'cinematicPrompt', label: 'Make it more cinematic', hint: 'Sharper light, lens and atmosphere', needsText: true },
  { id: 'raiseStakes', label: 'Raise the stakes', hint: 'More tension and consequence', needsText: true },
  { id: 'createVisualDirection', label: 'Visual direction pass', hint: 'Lighting, palette, lens, movement', empty: true },
  { id: 'tightenScene', label: 'Tighten it', hint: 'Cut to the essentials', needsText: true },
];

function demoSuggestion(scene) {
  return {
    suggestion: `${scene?.title || 'The scene'}: storm light breaks across wet stone as the camera pushes in low and slow; embers drift through volumetric haze, a 35mm anamorphic glow on rim-lit silhouettes, teal shadows against molten amber fire, epic scale, film grain, dark fantasy atmosphere.`,
    whatChanged: 'Grounded the shot in one camera move, added a palette contrast and atmospheric depth.',
    craftNote: 'One deliberate camera move reads as intention; three reads as noise.',
  };
}

/** Free AI Director assistance for the shot prompt. Never spends credits. */
export default function StudioDirector({ scene, project, styleName, onApply, open, onOpenChange }) {
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [instruction, setInstruction] = useState('');
  const wrapRef = useRef(null);
  const hasText = Boolean(scene?.prompt?.trim());

  useEffect(() => { setResult(null); setError(''); }, [scene?.id]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) onOpenChange(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open, onOpenChange]);

  async function run(action, custom = '') {
    setBusy(action + custom); setError(''); setResult(null);
    try {
      if (demoModeEnabled) {
        await new Promise((r) => setTimeout(r, 700));
        setResult(demoSuggestion(scene));
      } else {
        const data = await requestDirectorAssist({
          action: custom ? 'applyDirectorInstruction' : action,
          fieldType: 'videoPrompt',
          value: scene?.prompt || '',
          instruction: custom,
          context: {
            projectTitle: project?.title,
            fieldLabel: `Shot prompt for scene ${scene?.position}: ${scene?.title}`,
            style: styleName,
            sceneContext: scene?.purpose || '',
            duration: scene?.duration_seconds,
          },
        });
        setResult(data);
      }
      onOpenChange(false);
    } catch (e) {
      setError(e.message || 'The Director is unavailable right now.');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="sx-director" ref={wrapRef}>
      <button type="button" className={`sx-director-btn ${open ? 'is-open' : ''}`} onClick={() => onOpenChange(!open)} aria-expanded={open} aria-haspopup="menu" data-tour="director">
        <Icon.Spark /> Director <kbd>D</kbd>
      </button>
      {open && (
        <div className="sx-menu sx-director-menu" role="menu">
          <p className="sx-menu-heading">AI Director · free, never uses credits</p>
          {ACTIONS.filter((a) => (hasText ? !a.empty || a.id === 'createVisualDirection' : !a.needsText)).map((a) => (
            <button key={a.label} type="button" role="menuitem" onClick={() => run(a.id)} disabled={Boolean(busy)}>
              <span className="sx-dir-text"><strong>{a.label}</strong><small>{a.hint}</small></span>
              {busy === a.id && <span className="sx-mini-spin" aria-hidden="true" />}
            </button>
          ))}
          <form className="sx-dir-custom" onSubmit={(e) => { e.preventDefault(); if (instruction.trim()) run('applyDirectorInstruction', instruction.trim()); }}>
            <input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Or tell the Director what you want..." maxLength={400} aria-label="Director instruction" />
            <button type="submit" aria-label="Ask the Director" disabled={!instruction.trim() || Boolean(busy)}><Icon.ChevronRight /></button>
          </form>
        </div>
      )}
      {(busy || result || error) && (
        <div className={`sx-dir-card ${busy ? 'is-busy' : ''}`} role="status" aria-live="polite">
          {busy && <div className="sx-dir-thinking"><span className="sx-dir-orb" aria-hidden="true" /> The Director is framing your shot...</div>}
          {error && <p className="sx-problem">{error}</p>}
          {result && (
            <>
              <p className="sx-kicker">Director&apos;s draft</p>
              <p className="sx-dir-suggestion">{result.suggestion}</p>
              {result.whatChanged && <p className="sx-hint"><strong>What changed:</strong> {result.whatChanged}</p>}
              {result.craftNote && <p className="sx-hint sx-craft">“{result.craftNote}”</p>}
              <div className="sx-dir-actions">
                <button type="button" className="sx-btn sx-btn-gold sx-btn-sm" onClick={() => { onApply(result.suggestion, 'replace'); setResult(null); }}><Icon.Check /> Use this</button>
                {hasText && <button type="button" className="sx-btn sx-btn-sm" onClick={() => { onApply(result.suggestion, 'append'); setResult(null); }}>Add below</button>}
                <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => setResult(null)}>Discard</button>
              </div>
            </>
          )}
          {error && <button type="button" className="sx-link-btn" onClick={() => setError('')}>Dismiss</button>}
        </div>
      )}
    </div>
  );
}
