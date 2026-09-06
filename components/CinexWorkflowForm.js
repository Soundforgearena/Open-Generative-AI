'use client';

import { useEffect, useState } from 'react';

const DRAFT_PREFIX = 'cinexvideo_draft_';

export default function CinexWorkflowForm({ mode, template }) {
  const isStory = mode === 'story';
  const [values, setValues] = useState({
    idea: '',
    script: '',
    genre: '',
    style: '',
    duration: '30',
    notes: '',
  });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const savedDraft = JSON.parse(window.localStorage.getItem(`${DRAFT_PREFIX}${mode}`) || 'null');
      if (savedDraft) setValues((current) => ({ ...current, ...savedDraft }));
    } catch {
      // A malformed local draft should not prevent a new workflow.
    }
  }, [mode]);

  function updateValue(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
    if (error) setError('');
    if (saved) setSaved(false);
  }

  function handleSubmit(event) {
    event.preventDefault();
    const requiredValue = isStory ? values.idea.trim() : values.script.trim();
    if (!requiredValue) {
      setError(isStory ? 'Add a story idea before continuing.' : 'Add your script before continuing.');
      return;
    }

    const draft = {
      ...values,
      mode,
      template: template || null,
      saved_at: new Date().toISOString(),
    };
    window.localStorage.setItem(`${DRAFT_PREFIX}${mode}`, JSON.stringify(draft));
    setSaved(true);
  }

  return (
    <form className="cinex-workflow-form" onSubmit={handleSubmit} noValidate>
      {template && (
        <div className="cinex-selected-template">
          Template selected: <strong>{template}</strong>
        </div>
      )}

      {isStory ? (
        <label>
          Story idea
          <textarea
            name="idea"
            value={values.idea}
            onChange={updateValue}
            placeholder="A retired astronaut receives one final message from home..."
            rows={5}
            required
          />
        </label>
      ) : (
        <label>
          Script
          <textarea
            name="script"
            value={values.script}
            onChange={updateValue}
            placeholder="Paste your script, scene directions, and dialogue here..."
            rows={9}
            required
          />
        </label>
      )}

      <div className="cinex-form-grid">
        <label>
          {isStory ? 'Genre' : 'Visual style'}
          <input
            name={isStory ? 'genre' : 'style'}
            value={isStory ? values.genre : values.style}
            onChange={updateValue}
            placeholder={isStory ? 'Sci-fi drama' : 'Neo-noir'}
          />
        </label>
        <label>
          Duration
          <select name="duration" value={values.duration} onChange={updateValue}>
            <option value="15">15 seconds</option>
            <option value="30">30 seconds</option>
            <option value="60">60 seconds</option>
            <option value="120">2 minutes</option>
          </select>
        </label>
      </div>

      {isStory && (
        <label>
          Visual notes <span className="cinex-form-optional">Optional</span>
          <textarea
            name="notes"
            value={values.notes}
            onChange={updateValue}
            placeholder="Lighting, camera movement, locations, or references..."
            rows={4}
          />
        </label>
      )}

      {error && <p className="cinex-form-error" role="alert">{error}</p>}
      <button type="submit" className="cinex-route-primary">Save draft and continue</button>
      {saved && (
        <div className="cinex-form-success" role="status">
          Draft saved. Generation setup is coming next.
        </div>
      )}
    </form>
  );
}