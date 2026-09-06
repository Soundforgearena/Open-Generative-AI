'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { demoModeEnabled } from '@/lib/demo-mode';
import { generateDirectorSuggestion, applyDirectorInstruction } from '@/lib/ai-director-writing';
import AiDirectorWritingWindow from './AiDirectorWritingWindow';

const ACTIONS = {
  idea: [['generateIdeaDirections', 'Give me 3 story concepts'], ['raiseStakes', 'Suggest a conflict'], ['createCharacter', 'Create a main character'], ['suggestEnding', 'Suggest 3 endings'], ['buildStoryArc', 'Turn this into a short film premise']],
  story: [['expandStory', 'Expand this story'], ['buildStoryArc', 'Create a beginning, middle, and end'], ['improvePacing', 'Improve pacing'], ['raiseStakes', 'Raise the stakes'], ['suggestEnding', 'Add a twist'], ['tightenScene', 'Simplify for a short film']],
  script: [['writeNextScene', 'Write the next scene'], ['improveDialogue', 'Improve dialogue'], ['tightenScene', 'Tighten this scene'], ['createVisualDirection', 'Make it more cinematic'], ['improveScenePurpose', 'Improve character motivation']],
  visualNotes: [['createVisualDirection', 'Suggest a visual style'], ['createVisualDirection', 'Suggest lighting and color'], ['createVisualDirection', 'Suggest camera language'], ['createVisualDirection', 'Create a mood board description']],
  scene: [['improveScenePurpose', 'Strengthen scene purpose'], ['raiseStakes', 'Improve emotional turn'], ['createVisualDirection', 'Add visual detail'], ['improveDialogue', 'Improve narration'], ['tightenScene', 'Shorten this scene']],
  title: [['applyDirectorInstruction', 'Find a stronger title'], ['generateIdeaDirections', 'Find a stronger hook']],
};

export default function AiDirectorAssistant({ fieldType, value, context, onApply, onClose }) {
  const closeRef = useRef(null);
  const [result, setResult] = useState(null);
  const [instruction, setInstruction] = useState('');
  const [status, setStatus] = useState('');
  const [undoValue, setUndoValue] = useState(null);
  const [isWriting, setIsWriting] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const actions = ACTIONS[fieldType] || ACTIONS.scene;

  useEffect(() => {
    closeRef.current?.focus();
    function handleKey(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const completeWriting = useCallback(() => {
    if (!pendingAction) return;
    const next = pendingAction === 'applyDirectorInstruction'
      ? applyDirectorInstruction({ ...context, value }, instruction)
      : generateDirectorSuggestion(pendingAction, { ...context, value });
    setResult(next);
    setPendingAction(null);
    setIsWriting(false);
    setStatus('Director draft is ready.');
  }, [context, instruction, pendingAction, value]);

  function runAction(action) {
    if (!demoModeEnabled) return;
    setPendingAction(action);
    setIsWriting(true);
    setResult(null);
    setStatus('');
  }

  function applySuggestion(mode) {
    setUndoValue(value);
    if (mode === 'replace') onApply?.(result.suggestion);
    if (mode === 'insert') onApply?.(`${value}\n\n${result.suggestion}`);
    setStatus('Director suggestion applied. You can edit it anytime.');
  }

  function undoSuggestion() {
    if (undoValue !== null) onApply?.(undoValue);
    setUndoValue(null);
    setStatus('Original restored.');
  }

  async function copySuggestion() {
    try {
      await navigator.clipboard.writeText(result.suggestion);
      setStatus('Suggestion copied.');
    } catch {
      setStatus('Copy is unavailable in this browser.');
    }
  }

  return (
    <div className="cinex-director-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <AiDirectorWritingWindow
        isOpen={isWriting}
        isGenerating={isWriting}
        fieldType={fieldType}
        sourceText={value}
        genre={context.genre}
        visualStyle={context.style}
        isDemoMode={demoModeEnabled}
        onCancel={() => { setPendingAction(null); setIsWriting(false); }}
        onSkip={completeWriting}
        onComplete={completeWriting}
      />
      <aside className="cinex-director-panel" role="dialog" aria-modal="true" aria-labelledby="ai-director-title">
        <div className="cinex-director-header">
          <div>
            <p className="cinex-shot-plan-eyebrow">AI Director</p>
            <h2 id="ai-director-title">Your creative writing partner</h2>
            <p>For story, script, and screen direction.</p>
          </div>
          <button ref={closeRef} type="button" className="cinex-director-close" onClick={onClose} aria-label="Close AI Director">×</button>
        </div>
        {demoModeEnabled && <p className="cinex-demo-indicator">Demo Director preview — suggestions are generated locally. No model call, video generation, or credits are used.</p>}
        {!demoModeEnabled && <p className="cinex-auth-required">Writing assistance is available in local demo mode. Connect the authenticated Director service for live suggestions.</p>}
        <div className="cinex-director-actions">
          {actions.map(([action, label]) => <button type="button" key={`${action}-${label}`} onClick={() => runAction(action)} disabled={!demoModeEnabled}>{label}</button>)}
        </div>
        <label className="cinex-director-prompt">
          Tell the Director what you need
          <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Example: Make this feel like a tense psychological thriller with a hopeful ending." rows={3} />
        </label>
        <button type="button" className="cinex-route-primary" onClick={() => runAction('applyDirectorInstruction')} disabled={!demoModeEnabled || !instruction.trim()}>Ask Director</button>
        {result && (
          <article className="cinex-director-result" aria-live="polite">
            <p className="cinex-shot-plan-eyebrow">DIRECTOR&apos;S DRAFT</p>
            <p className="cinex-director-suggestion">{result.suggestion}</p>
            <p><strong>What changed:</strong> {result.whatChanged}</p>
            <p><strong>Craft note:</strong> {result.craftNote}</p>
            {result.followUpPrompts?.length > 0 && <p><strong>Next question:</strong> {result.followUpPrompts[0]}</p>}
            <div className="cinex-director-result-actions">
              <button type="button" onClick={() => applySuggestion('replace')}>Replace field</button>
              <button type="button" onClick={() => applySuggestion('insert')}>Insert below</button>
              <button type="button" onClick={copySuggestion}>Copy</button>
              {undoValue !== null && <button type="button" onClick={undoSuggestion}>Undo</button>}
              <button type="button" onClick={() => setResult(null)}>Try another direction</button>
              <button type="button" onClick={() => { setResult(null); setStatus('Original kept.'); }}>Keep my original</button>
            </div>
          </article>
        )}
        {status && <p className="cinex-form-success" role="status" aria-live="polite">{status}</p>}
      </aside>
    </div>
  );
}
