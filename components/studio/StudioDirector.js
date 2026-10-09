'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { demoModeEnabled } from '@/lib/demo-mode';
import { maxDirectorCredits, typicalDirectorCredits } from '@/lib/billing/director-pricing';
import { getDirectorPricing, requestDirectorAssist } from '@/lib/cinexvideo-client';
import { createStaleGuard } from '@/lib/studio/async-guard';
import { createActionLock } from '@/lib/studio/action-lock';

const FALLBACK = { max_credits: maxDirectorCredits('assist', 'gpt-5'), typical_credits: typicalDirectorCredits('assist', 'gpt-5') };

function usd(credits) {
  return `$${(Number(credits || 0) / 100).toFixed(2)}`;
}

function demoSuggestion(scene) {
  return {
    prompt: `Cinematic ${scene?.title || 'shot'}: establish the subject, add controlled camera movement, and end on a clear visual beat.`,
    negative_prompt: 'blurry, distorted faces, extra limbs, watermark, text overlay',
  };
}

export default function StudioDirector({ scene, project, styleName, onApply, onOpenChange, paidCredits, setPaidCredits, onCharged }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(FALLBACK);
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

  useEffect(() => {
    setResult(null);
    setError('');
    setRetryAction(null);
    setNeedsCredits(false);
    activeIdempotencyKeyRef.current = null;
  }, [scene?.id]);

  useEffect(() => {
    if (demoModeEnabled) return;
    let cancelled = false;
    getDirectorPricing()
      .then((data) => {
        if (!cancelled && data) setPrice(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  async function run(action, custom = '', retryIdempotencyKey = null) {
    if (!demoModeEnabled && paidCredits !== null && paidCredits < price.max_credits) {
      setNeedsCredits(true);
      setError(`The AI Director runs on purchased credits. A request can cost up to ${price.max_credits} credits (${usd(price.max_credits)}) and you have ${paidCredits} purchased credits. Sign-up bonus credits can't be used for the Director.`);
      onOpenChange(false);
      return;
    }
    if (!actionLock.current.tryAcquire()) return;
    setError('');
    setResult(null);
    setNeedsCredits(false);
    setRetryAction(null);
    const isCurrent = guardRef.current.capture();
    const idempotencyKey = retryIdempotencyKey || crypto.randomUUID();
    activeIdempotencyKeyRef.current = idempotencyKey;
    setBusy(action);
    try {
      if (demoModeEnabled) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        if (!isCurrent()) return;
        setResult(demoSuggestion(scene));
      } else {
        const data = await requestDirectorAssist({
          idempotencyKey,
          action,
          instruction: custom || undefined,
          scene: {
            id: scene?.id,
            title: scene?.title,
            prompt: scene?.prompt,
            negative_prompt: scene?.negative_prompt,
            duration: scene?.duration_seconds,
          },
        });
        if (data?.credits_charged) {
          onCharged?.(data.credits_charged);
          setPaidCredits((current) => (current === null ? current : Math.max(0, current - data.credits_charged)));
        }
        if (!isCurrent()) return;
        setResult(data);
        activeIdempotencyKeyRef.current = null;
      }
      onOpenChange(false);
    } catch (requestError) {
      if (!isCurrent()) return;
      if (requestError.status === 402) {
        setNeedsCredits(true);
        activeIdempotencyKeyRef.current = null;
      } else {
        setRetryAction({ action, custom, idempotencyKey });
      }
      setError(
        requestError.status === 402
          ? (requestError.message || 'The AI Director runs on purchased credits. Add credits to keep directing.')
          : `${requestError.message || 'The Director is unavailable right now.'} No credits were charged.`,
      );
    } finally {
      setBusy('');
      actionLock.current.release();
    }
  }

  return (
    <div className="sx-dir" ref={wrapRef}>
      <button
        type="button"
        className="sx-btn sx-btn-sm"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        Ask the Director
      </button>
      {open && (
        <div className="sx-dir-panel" role="dialog" aria-label="AI Director">
          <div className="sx-dir-actions">
            {[
              ['improvePrompt', 'Improve prompt'],
              ['suggestShot', 'Suggest shot'],
              ['suggestNegative', 'Avoid artifacts'],
            ].map(([action, label]) => (
              <button
                key={action}
                type="button"
                className="sx-chip"
                disabled={Boolean(busy)}
                onClick={() => run(action)}
              >
                {action === 'improvePrompt' && !hasText ? 'Write prompt' : label}
              </button>
            ))}
            <form
              className="sx-dir-custom"
              onSubmit={(event) => {
                event.preventDefault();
                if (instruction.trim()) run('applyDirectorInstruction', instruction.trim());
              }}
            >
              <input
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="Or tell the Director what you want..."
                maxLength={400}
                aria-label="Director instruction"
              />
              <button
                type="submit"
                aria-label="Ask the Director"
                disabled={!instruction.trim() || Boolean(busy)}
              >
                {busy === 'applyDirectorInstruction' ? <span className="sx-mini-spin" aria-hidden="true" /> : '→'}
              </button>
            </form>
          </div>
          {(busy || result || error) && (
            <div className={`sx-dir-card ${busy ? 'is-busy' : ''}`} role="status" aria-live="polite">
              {busy && <div className="sx-dir-thinking">The Director is framing your shot...</div>}
              {error && <p className="sx-problem">{error}</p>}
              {retryAction && error && (
                <button
                  type="button"
                  className="sx-btn sx-btn-sm"
                  disabled={Boolean(busy)}
                  onClick={() => run(retryAction.action, retryAction.custom, retryAction.idempotencyKey)}
                >
                  Try again
                </button>
              )}
              {result && (
                <>
                  <p className="sx-kicker">Director's draft</p>
                  <p>{result.prompt}</p>
                  {result.negative_prompt && <p className="sx-hint">Avoid: {result.negative_prompt}</p>}
                  <button
                    type="button"
                    className="sx-btn sx-btn-gold sx-btn-sm"
                    onClick={() => {
                      onApply(result);
                      onOpenChange(false);
                    }}
                  >
                    Apply
                  </button>
                </>
              )}
              {needsCredits && <Link href="/account" className="sx-btn sx-btn-gold sx-btn-sm">Add credits</Link>}
              {error && (
                <button
                  type="button"
                  className="sx-link-btn"
                  onClick={() => {
                    setError('');
                    setNeedsCredits(false);
                    setRetryAction(null);
                    activeIdempotencyKeyRef.current = null;
                  }}
                >
                  Dismiss
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
