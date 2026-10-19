'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createProject, getDirectorPricing, requestDirectorPlan } from '@/lib/cinexvideo-client';
import { createDemoProject, saveDemoProject } from '@/lib/demo-project-store';
import { demoModeEnabled } from '@/lib/demo-mode';
import { createStoryboard } from '@/lib/storyboard';
import { validateProjectInput } from '@/lib/validation';
import AskAiDirectorButton from './AskAiDirectorButton';

const STYLES = ['Cinematic', 'Neo-noir', 'Documentary', 'Music video', 'Animation', 'Commercial'];
const RATIOS = ['16:9', '9:16', '4:3', '1:1', '2.39:1'];
const DURATIONS = [15, 30, 60, 120];

export default function DemoProjectBuilder({ sourceType = 'idea', template, onCreated }) {
  const [values, setValues] = useState({
    title: template?.title || '',
    sourceText: template?.starterPrompt || '',
    style: template?.category || 'Cinematic',
    aspectRatio: template?.aspectRatio || '16:9',
    duration: template?.duration || 30,
    notes: '',
  });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [project, setProject] = useState(null);
  const [saving, setSaving] = useState(false);
  // AI Director planning (paid with purchased credits, price shown first).
  const router = useRouter();
  const [pricing, setPricing] = useState(null);
  const [confirmPlan, setConfirmPlan] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [needsCredits, setNeedsCredits] = useState(false);
  useEffect(() => {
    if (demoModeEnabled) return;
    getDirectorPricing().then(setPricing).catch(() => setPricing(null));
  }, []);
  const planPrice = pricing?.plan;
  const paidAvailable = Number(pricing?.paid_credits_available);
  const canAffordPlan = !planPrice || !Number.isFinite(paidAvailable) || pricing?.at_cost || paidAvailable >= planPrice.max_credits;

  function openStudio(id) {
    if (onCreated) onCreated(id);
    else router.push(`/studio?project=${encodeURIComponent(id)}&welcome=1`);
  }

  function directorBrief() {
    const kind = sourceType === 'script' ? 'script' : sourceType === 'story' ? 'story' : 'idea';
    return [
      `Plan a ${values.duration}-second ${values.style} episode, shot by shot, from this ${kind}.`,
      `${kind[0].toUpperCase()}${kind.slice(1)}: ${values.sourceText.trim()}`,
      values.title.trim() ? `Working title: ${values.title.trim()}.` : '',
      values.notes.trim() ? `Visual notes: ${values.notes.trim()}` : '',
      `Frame everything for ${values.aspectRatio}. Scene durations should add up to about ${values.duration} seconds.`,
      template?.title ? `Template: ${template.title}.` : '',
    ].filter(Boolean).join('\n');
  }

  function askPlan(event) {
    event.preventDefault();
    if (saving || planning) return;
    const nextErrors = validateProjectInput(values);
    setErrors(nextErrors);
    setMessage('');
    setNeedsCredits(false);
    if (Object.keys(nextErrors).length) return;
    setConfirmPlan(true);
  }

  async function runPlan() {
    if (planning) return;
    setPlanning(true);
    setMessage('');
    try {
      const plan = await requestDirectorPlan(directorBrief(), 'episode');
      if (!plan?.scenes?.length) throw new Error('The Director could not plan this one. You were not charged. Try adding more detail.');
      const result = await createProject({
        lane: 'episode',
        title: values.title,
        plan: {
          ...plan,
          creative_title: values.title.trim() || plan.creative_title,
          visual_identity: { ...(plan.visual_identity || {}), style: values.style, aspect_ratio: values.aspectRatio, duration: values.duration, style_notes: values.notes.trim() || undefined },
        },
      });
      setConfirmPlan(false);
      setMessage(`The Director planned ${plan.scenes.length} scenes. Opening the Studio...`);
      openStudio(result.project_id);
    } catch (planError) {
      setNeedsCredits(/credit/i.test(planError.message || ''));
      setMessage(planError.message || 'The Director is unavailable right now. You were not charged.');
    } finally {
      setPlanning(false);
    }
  }

  useEffect(() => {
    if (!template) return;
    setValues((current) => ({
      ...current,
      title: current.title || template.title,
      sourceText: current.sourceText || template.starterPrompt,
      style: template.category || current.style,
      aspectRatio: template.aspectRatio || current.aspectRatio,
    }));
  }, [template]);

  const sourceLabel = sourceType === 'script' ? 'Script' : sourceType === 'story' ? 'Story / prompt' : sourceType === 'template' ? 'Template prompt' : 'Idea';

  function updateValue(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: name === 'duration' ? Number(value) : value }));
    setErrors((current) => ({ ...current, [name]: '' }));
    setMessage('');
  }

  async function createProjectDraft(event) {
    event.preventDefault();
    if (saving) return;
    const nextErrors = validateProjectInput(values);
    setErrors(nextErrors);
    setMessage('');
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    const scenes = createStoryboard(values.sourceText, values.duration, values.style);
    try {
      let nextProject;
      if (demoModeEnabled) {
        nextProject = createDemoProject({ ...values, sourceType, scenes });
      } else {
        const result = await createProject({
          lane: 'episode',
          title: values.title,
          plan: {
            creative_title: values.title,
            logline: values.sourceText,
            visual_identity: { style: values.style, aspect_ratio: values.aspectRatio, duration: values.duration },
            scenes: scenes.map((scene) => ({
              title: scene.title,
              purpose: scene.summary,
              duration_seconds: scene.estimatedDuration,
              shot_direction: scene.visualPrompt,
              prompt: scene.visualPrompt,
              narration: scene.narration,
            })),
          },
        });
        nextProject = { ...values, sourceType, id: result.project_id, scenes };
      }
      setProject(nextProject);
      setMessage('Draft saved. Review the shot plan before generation.');
      if (!demoModeEnabled) openStudio(nextProject.id);
      else onCreated?.(nextProject.id);
    } catch (saveError) {
      setMessage(saveError.message || 'The draft could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cinex-builder-wrap">
      {!demoModeEnabled && (
        <div className="cinex-auth-required" role="status">
          Your draft will be saved to your authenticated CineXVideo account.
        </div>
      )}
      {demoModeEnabled && <p className="cinex-demo-indicator">Demo mode — local data only</p>}
      <form className="cinex-workflow-form" onSubmit={createProjectDraft} noValidate>
        {template && <div className="cinex-selected-template">Template selected: <strong>{template.title}</strong></div>}
        <label>
          Project title
          <input name="title" value={values.title} onChange={updateValue} placeholder="Midnight Signal" required />
          {errors.title && <span className="cinex-form-error">{errors.title}</span>}
          <AskAiDirectorButton fieldType="title" value={values.title} context={{ sourceType, style: values.style, duration: values.duration }} onApply={(suggestion) => setValues((current) => ({ ...current, title: suggestion.split('\n')[0] }))} />
        </label>
        <label>
          {sourceLabel}
          <textarea name="sourceText" value={values.sourceText} onChange={updateValue} rows={sourceType === 'script' ? 10 : 6} placeholder="Describe the story, world, or script..." required />
          {errors.sourceText && <span className="cinex-form-error">{errors.sourceText}</span>}
          <AskAiDirectorButton fieldType={sourceType === 'script' ? 'script' : sourceType === 'idea' ? 'idea' : 'story'} value={values.sourceText} context={{ sourceType, genre: values.style, duration: values.duration, style: values.style }} onApply={(suggestion) => setValues((current) => ({ ...current, sourceText: suggestion }))} />
        </label>
        <label>
          Visual notes <span className="cinex-form-optional">Optional</span>
          <textarea name="notes" value={values.notes} onChange={updateValue} rows={3} placeholder="Lighting, camera movement, or references..." />
          <AskAiDirectorButton fieldType="visualNotes" value={values.notes} context={{ sourceType, style: values.style, duration: values.duration }} onApply={(suggestion) => setValues((current) => ({ ...current, notes: suggestion }))} />
        </label>
        <div className="cinex-form-grid">
          <label>
            Visual style
            <select name="style" value={values.style} onChange={updateValue}>
              {STYLES.map((style) => <option key={style}>{style}</option>)}
            </select>
          </label>
          <label>
            Aspect ratio
            <select name="aspectRatio" value={values.aspectRatio} onChange={updateValue}>
              {RATIOS.map((ratio) => <option key={ratio}>{ratio}</option>)}
            </select>
          </label>
          <label>
            Target duration
            <select name="duration" value={values.duration} onChange={updateValue}>
              {DURATIONS.map((duration) => <option key={duration} value={duration}>{duration} seconds</option>)}
            </select>
          </label>
        </div>
        {demoModeEnabled ? (
          <button type="submit" className="cinex-route-primary" disabled={saving}>
            {saving ? 'Saving draft...' : 'Save draft and build shot plan'}
          </button>
        ) : (
          <div className="cinex-plan-actions">
            <button type="button" className="cinex-route-primary" disabled={saving || planning} onClick={askPlan}>
              {planning ? 'The Director is planning...' : `Plan with the AI Director${planPrice ? ` · about ${planPrice.typical_credits} credits` : ''}`}
            </button>
            <button type="submit" className="cinex-route-secondary-link" disabled={saving || planning}>
              {saving ? 'Saving draft...' : 'Or save a basic draft (free)'}
            </button>
          </div>
        )}
        {confirmPlan && !demoModeEnabled && (
          <div className="cinex-plan-confirm" role="dialog" aria-label="Confirm AI Director plan">
            <strong>Let the AI Director plan your episode?</strong>
            <span>It decides how viewers should feel, then builds every scene: emotion, camera, light, cast, places and readable signs. Usually about {planPrice?.typical_credits ?? 10} credits, never more than {planPrice?.max_credits ?? 23} (1 credit = $0.01), paid with purchased credits. If it fails, you are not charged.</span>
            {Number.isFinite(paidAvailable) && !pricing?.at_cost && <span>Your purchased credits: {paidAvailable}</span>}
            {!canAffordPlan && <span className="cinex-form-error">You need at least {planPrice.max_credits} purchased credits. <Link href="/account?buy=1">Buy credits</Link></span>}
            <div className="cinex-plan-actions">
              <button type="button" className="cinex-route-primary" disabled={planning || !canAffordPlan} onClick={runPlan}>{planning ? 'Planning...' : `Confirm · max ${planPrice?.max_credits ?? 23} credits`}</button>
              <button type="button" className="cinex-route-secondary-link" disabled={planning} onClick={() => setConfirmPlan(false)}>Cancel</button>
            </div>
          </div>
        )}
        {message && <p className="cinex-form-success" role="status">{message}{needsCredits && <> <Link href="/account?buy=1">Buy credits</Link></>}</p>}
        {project && demoModeEnabled && (
          <div className="cinex-dashboard-actions">
            <Link href={`/create/review?project=${encodeURIComponent(project.id)}`} className="cinex-route-primary">Review Shot Plan</Link>
            <Link href="/create" className="cinex-route-secondary-link">Back to Creation Hub</Link>
          </div>
        )}
      </form>
    </div>
  );
}

export function StoryboardPreview({ project }) {
  return (
    <section className="cinex-shot-plan" aria-labelledby="storyboard-preview-title">
      <p className="cinex-shot-plan-eyebrow">Storyboard preview</p>
      <h2 id="storyboard-preview-title">{project.title}</h2>
      <p className="cinex-shot-plan-logline">Demo preview — no video was generated and no credits were used.</p>
      <div className="cinex-scene-list">
        {(project.scenes || []).map((scene) => (
          <article className="cinex-scene-card" key={scene.id}>
            <div className="cinex-scene-card-header"><strong>Scene {scene.sceneNumber}</strong><span>{scene.status} · {scene.estimatedDuration}s</span></div>
            <p><strong>{scene.title}</strong></p>
            <p>{scene.summary}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
