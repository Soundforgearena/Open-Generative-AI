'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { requestDirectorPlan } from '@/lib/cinexvideo-client';

const DRAFT_PREFIX = 'cinexvideo_draft_';
const GENRES = [
  'Action',
  'Sci-Fi',
  'Horror',
  'Thriller',
  'Drama',
  'Comedy',
  'Romance',
  'Fantasy',
  'Documentary',
  'Music Video',
  'Commercial',
  'Anime-inspired',
  'Family Animation',
  'Custom',
];
const STYLES = ['Cinematic', 'Neo-noir', 'Documentary', 'Music video', 'Animation', 'Custom'];

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
  const [plan, setPlan] = useState(null);
  const [planning, setPlanning] = useState(false);

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
    if (plan) setPlan(null);
  }

  async function handleSubmit(event) {
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
    setPlanning(true);
    setError('');

    const visualDirection = isStory
      ? (values.genre === 'Custom' ? values.customGenre : values.genre)
      : (values.style === 'Custom' ? values.customStyle : values.style);
    const prompt = isStory
      ? `Create a shot-by-shot ${visualDirection || 'cinematic'} plan for this ${values.duration}-second story. Story idea: ${values.idea}. Visual notes: ${values.notes || 'Use your best cinematic judgment.'}${template ? ` Selected template: ${template}.` : ''}`
      : `Create a shot-by-shot ${visualDirection || 'cinematic'} plan for this ${values.duration}-second script. Script: ${values.script}${template ? ` Selected template: ${template}.` : ''}`;

    try {
      const directorPlan = await requestDirectorPlan(prompt, 'episode');
      setPlan(directorPlan);
    } catch (directorError) {
      setError(directorError.message || 'Sign in to ask the AI Director for a shot plan.');
    } finally {
      setPlanning(false);
    }
  }

  function getSceneRange(scenes, index) {
    const start = scenes.slice(0, index).reduce((total, scene) => total + scene.duration_seconds, 0);
    const end = start + scenes[index].duration_seconds;
    return `${start}-${end} sec`;
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
          <select
            name={isStory ? 'genre' : 'style'}
            value={isStory ? values.genre : values.style}
            onChange={updateValue}
          >
            <option value="">Choose {isStory ? 'a genre' : 'a visual style'}</option>
            {(isStory ? GENRES : STYLES).map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        {((isStory && values.genre === 'Custom') || (!isStory && values.style === 'Custom')) && (
          <label>
            Custom {isStory ? 'genre' : 'style'}
            <input
              name={isStory ? 'customGenre' : 'customStyle'}
              value={isStory ? values.customGenre || '' : values.customStyle || ''}
              onChange={updateValue}
              placeholder={isStory ? 'Sci-fi drama' : 'Your visual direction'}
            />
          </label>
        )}
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
      <button type="submit" className="cinex-route-primary" disabled={planning}>
        {planning ? 'AI Director is planning...' : 'Save draft and build shot plan'}
      </button>
      {saved && (
        <div className="cinex-form-success" role="status">
          Draft saved. Review the shot plan before generation.
        </div>
      )}
      {plan?.scenes?.length > 0 && (
        <section className="cinex-shot-plan" aria-labelledby="shot-plan-title">
          <div className="cinex-shot-plan-heading">
            <div>
              <p className="cinex-shot-plan-eyebrow">AI Director</p>
              <h2 id="shot-plan-title">{plan.creative_title || 'Proposed shot plan'}</h2>
            </div>
            <span>{plan.scenes.length} shots</span>
          </div>
          {plan.logline && <p className="cinex-shot-plan-logline">{plan.logline}</p>}
          <ol className="cinex-shot-list">
            {plan.scenes.map((scene, index) => (
              <li key={`${scene.title}-${index}`}>
                <span className="cinex-shot-time">{getSceneRange(plan.scenes, index)}</span>
                <strong>{scene.title}</strong>
                <span>{scene.shot_direction}</span>
              </li>
            ))}
          </ol>
          <p className="cinex-shot-plan-next">Plan ready. Generation setup is coming next.</p>
          <Link href="/create" className="cinex-route-secondary-link">Back to creation hub</Link>
        </section>
      )}
    </form>
  );
}