'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './StudioIcons';
import { requestDirectorAssist } from '@/lib/cinexvideo-client';
import Link from 'next/link';
import { demoModeEnabled } from '@/lib/demo-mode';
import { maxDirectorCredits, typicalDirectorCredits } from '@/lib/billing/director-pricing';
import { getDirectorPricing } from '@/lib/cinexvideo-client';
import { createStaleGuard } from '@/lib/studio/async-guard';
import { createActionLock } from '@/lib/studio/action-lock';

// Shown until the live price list loads (default model).
const FALLBACK = { max_credits: maxDirectorCredits('assist', 'gpt-5'), typical_credits: typicalDirectorCredits('assist', 'gpt-5') };
const usd = (credits) => `$${(credits / 100).toFixed(2)}`;

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

/**
 * AI Director assistance for the shot prompt. Paid with purchased credits only:
 * the maximum is reserved up front, the user is charged for what was actually
 * used, and failed requests cost nothing.
 */
export default function StudioDirector({ scene, project, styleName, onApply, open, onOpenChange, onCharged }) {
  const [price, setPrice] = useState(FALLBACK);
  const [paidCredits, setPaidCredits] = useState(null);
  const [atCost, setAtCost] = useState(false);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [retryAction, setRetryAction] = useState(null);
  const [needsCredits, setNeedsCredits] = useState(false);
  const [instruction, setInstruction] = useState('');
  const wrapRef = useRef(null);
  const actionLock = useRef(null);
  if (!actionLock.current) actionLock.current = createActionLock();
  const activeIdempotencyKeyRef = useRef(null);
  const sceneIdRef = useRef(scene?.id);
  const guardRef = useRef(null);
  if (!guardRef.current) guardRef.current = createStaleGuard(() => sceneIdRef.current);
  if (sceneIdRef.current !== scene?.id) {
    sceneIdRef.current = scene?.id;
    guardRef.current.invalidate();
    activeIdempotencyKeyRef.current = null;
  }
  useEffect(() => {
    const guard = guardRef.current;
    guard.start();
    return () => guard.stop();
  }, []);
  const hasText = Boolean(scene?.prompt?.trim());

  useEffect(() => { setResult(null); setError(''); setRetryAction(null); setNeedsCredits(false); activeIdempotencyKeyRef.current = null; }, [scene?.id]);

  useEffect(() => {
    if (demoModeEnabled) return;
    let live = true;
    getDirectorPricing()
      .then((data) => {
        if (!live) return;
        if (data?.assist?.max_credits) setPrice(data.assist);
        if (data?.at_cost) setAtCost(true);
        if (data?.paid_credits_available !== null && data?.paid_credits_available !== undefined) setPaidCredits(Number(data.paid_credits_available));
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) onOpenChange(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open, onOpenChange]);

  async function run(action, custom = '', retryIdempotencyKey = null) {
    setError(''); setResult(null); setNeedsCredits(false); setRetryAction(null);
    if (!demoModeEnabled && paidCredits !== null && paidCredits < price.max_credits) {
      setNeedsCredits(true);
      setError(`The AI Director runs on purchased credits. A request can cost up to ${price.max_credits} credits (${usd(price.max_credits)}) and you have ${paidCredits} purchased credits. Sign-up bonus credits can't be used for the Director.`);
      onOpenChange(false);
      return;
    }
    if (!actionLock.current.tryAcquire()) return;
    const isCurrent = guardRef.current.capture();
    const idempotencyKey = retryIdempotencyKey || crypto.randomUUID();
    activeIdempotencyKeyRef.current = idempotencyKey;
    setBusy(action + custom);
    try {
      if (demoModeEnabled) {
        await new Promise((r) => setTimeout(r, 700));
        if (!isCurrent()) return;
        setResult(demoSuggestion(scene));
      } else {
        const data = await requestDirectorAssist({
          idempotencyKey,
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
        if (data?.credits_charged) {
          onCharged?.(data.credits_charged);
          setPaidCredits((c) => (c === null ? c : Math.max(0, c - data.credits_charged)));
        }
        if (!isCurrent()) return;
        setResult(data);
        activeIdempotencyKeyRef.current = null;
      }
      onOpenChange(false);
    } catch (e) {
      if (!isCurrent()) return;
      if (e.status === 402) {
        setNeedsCredits(true);
        activeIdempotencyKeyRef.current = null;
      } else {
        setRetryAction({ action, custom, idempotencyKey });
      }
      setError(e.status === 402 ? (e.message || `The AI Director runs on purchased credits. Add credits to keep directing.`) : `${e.message || 'The Director is unavailable right now.'} No credits were charged.`);
    } finally {
      setBusy('');
      actionLock.current.release();
    }
  }

  return (
    <div className="sx-director" ref={wrapRef}>
      <button type="button" className={`sx-director-btn ${open ? 'is-open' : ''}`} onClick={() => onOpenChange(!open)} aria-expanded={open} aria-haspopup="menu" data-tour="director">
        <Icon.Spark /> Director <kbd>D</kbd>
      </button>
      {open && (
        <div className="sx-menu sx-director-menu" role="menu">
          <p className="sx-menu-heading">AI Director · {atCost ? 'at cost' : 'purchased credits'}</p>
          {<p className="sx-dir-price">{atCost ? 'Super admin, at cost (no markup). ' : ''}Usually ~{price.typical_credits} credits ({usd(price.typical_credits)}), never more than {price.max_credits} ({usd(price.max_credits)}). You only pay for what the Director uses. 1 credit = $0.01.</p>}
          {ACTIONS.filter((a) => (hasText ? !a.empty || a.id === 'createVisualDirection' : !a.needsText)).map((a) => (
            <button key={a.label} type="button" role="menuitem" onClick={() => run(a.id)} disabled={Boolean(busy)}>
              <span className="sx-dir-text"><strong>{a.label}</strong><small>{a.hint}</small></span>
              {busy === a.id ? <span className="sx-mini-spin" aria-hidden="true" /> : <span className="sx-dir-cost">~{price.typical_credits} cr</span>}
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
          {retryAction && error && <button type="button" className="sx-btn sx-btn-sm" disabled={Boolean(busy)} onClick={() => run(retryAction.action, retryAction.custom, retryAction.idempotencyKey)}>Try again</button>}
          {result && (
            <>
              <p className="sx-kicker">Director's draft</p>
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
          {needsCredits && <Link href="/account" className="sx-btn sx-btn-gold sx-btn-sm sx-dir-buy">Add credits</Link>}
          {error && <button type="button" className="sx-link-btn" onClick={() => { setError(''); setNeedsCredits(false); setRetryAction(null); activeIdempotencyKeyRef.current = null; }}>Dismiss</button>}
          {result && !demoModeEnabled && result.credits_charged > 0 && <p className="sx-hint sx-dir-charged">{result.credits_charged} credits used ({usd(result.credits_charged || 0)}) · max was {result.credits_max}</p>}
        </div>
      )}
    </div>
  );
}
