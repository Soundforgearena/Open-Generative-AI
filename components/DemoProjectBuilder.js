'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createDemoProject, getDemoProject, saveDemoProject } from '@/lib/demo-project-store';
import { demoModeEnabled } from '@/lib/demo-mode';
import { createStoryboard } from '@/lib/storyboard';
import { validateProjectInput } from '@/lib/validation';

const STYLES = ['Cinematic', 'Neo-noir', 'Documentary', 'Music video', 'Animation', 'Commercial'];
const RATIOS = ['16:9', '9:16', '4:3', '1:1', '2.39:1'];
const DURATIONS = [15, 30, 60, 120];

export default function DemoProjectBuilder({ sourceType = 'idea', template }) {
  const [values, setValues] = useState({
    title: template?.title || '',
    sourceText: template?.starterPrompt || '',
    style: template?.category || 'Cinematic',
    aspectRatio: template?.aspectRatio || '16:9',
    duration: template?.duration || 30,
  });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [project, setProject] = useState(null);

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

  const sourceLabel = sourceType === 'script' ? 'Script' : sourceType === 'story' ? 'Story / prompt' : 'Idea';

  function updateValue(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: name === 'duration' ? Number(value) : value }));
    setErrors((current) => ({ ...current, [name]: '' }));
    setMessage('');
  }

  function createProjectDraft(event) {
    event.preventDefault();
    if (!demoModeEnabled) {
      setMessage('Demo mode is disabled. Sign in to continue with your connected account.');
      return;
    }
    const nextErrors = validateProjectInput(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const scenes = createStoryboard(values.sourceText, values.duration, values.style);
    const nextProject = createDemoProject({ ...values, sourceType, scenes });
    setProject(nextProject);
    setMessage('Storyboard preview saved locally. No video was generated.');
  }

  return (
    <div className="cinex-builder-wrap">
      {!demoModeEnabled && (
        <div className="cinex-auth-required" role="status">
          Sign in is required for production projects. Enable local demo mode to try the workflow without calling production APIs.
          <Link href="/auth?next=/create" className="cinex-route-secondary-link">Continue to sign in</Link>
        </div>
      )}
      {demoModeEnabled && <p className="cinex-demo-indicator">Demo mode — local data only</p>}
      <form className="cinex-workflow-form" onSubmit={createProjectDraft} noValidate>
        {template && <div className="cinex-selected-template">Template selected: <strong>{template.title}</strong></div>}
        <label>
          Project title
          <input name="title" value={values.title} onChange={updateValue} placeholder="Midnight Signal" required />
          {errors.title && <span className="cinex-form-error">{errors.title}</span>}
        </label>
        <label>
          {sourceLabel}
          <textarea name="sourceText" value={values.sourceText} onChange={updateValue} rows={sourceType === 'script' ? 10 : 6} placeholder="Describe the story, world, or script..." required />
          {errors.sourceText && <span className="cinex-form-error">{errors.sourceText}</span>}
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
        <button type="submit" className="cinex-route-primary">Create storyboard preview</button>
        {message && <p className="cinex-form-success" role="status">{message}</p>}
      </form>
      {project && <StoryboardPreview project={project} onSave={setProject} />}
    </div>
  );
}

export function StoryboardPreview({ project: initialProject, onSave }) {
  const [project, setProject] = useState(initialProject);
  const [busy, setBusy] = useState(false);

  function updateProject(next) {
    setProject(next);
    onSave(next);
    saveDemoProject(next);
  }

  function updateScene(index, patch) {
    const scenes = project.scenes.map((scene, sceneIndex) => sceneIndex === index ? { ...scene, ...patch } : scene);
    updateProject({ ...project, scenes });
  }

  function moveScene(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= project.scenes.length) return;
    const scenes = [...project.scenes];
    [scenes[index], scenes[target]] = [scenes[target], scenes[index]];
    updateProject({ ...project, scenes: scenes.map((scene, sceneIndex) => ({ ...scene, sceneNumber: sceneIndex + 1 })) });
  }

  function addScene() {
    const scenes = [...project.scenes, {
      id: `demo-scene-${Date.now()}`,
      sceneNumber: project.scenes.length + 1,
      title: 'New scene',
      summary: 'Add a beat to the storyboard.',
      estimatedDuration: 5,
      visualPrompt: project.style,
      narration: '',
      status: 'Draft',
    }];
    updateProject({ ...project, scenes });
  }

  function deleteScene(index) {
    const scenes = project.scenes.filter((_, sceneIndex) => sceneIndex !== index).map((scene, sceneIndex) => ({ ...scene, sceneNumber: sceneIndex + 1 }));
    updateProject({ ...project, scenes });
  }

  function simulatePreview() {
    setBusy(true);
    const statuses = ['Queued', 'Generating', 'Completed'];
    statuses.forEach((status, index) => {
      setTimeout(() => {
        const scenes = project.scenes.map((scene) => ({ ...scene, status }));
        setProject((current) => ({ ...current, status, scenes }));
        saveDemoProject({ ...project, status, scenes });
        if (index === statuses.length - 1) setBusy(false);
      }, (index + 1) * 500);
    });
  }

  return (
    <section className="cinex-shot-plan" aria-labelledby="storyboard-title">
      <div className="cinex-shot-plan-heading">
        <div>
          <p className="cinex-shot-plan-eyebrow">Storyboard preview</p>
          <h2 id="storyboard-title">{project.title}</h2>
        </div>
        <span className="cinex-status-badge">{project.status}</span>
      </div>
      <p className="cinex-shot-plan-logline">Demo preview — no video was generated and no credits were used.</p>
      <div className="cinex-scene-list">
        {project.scenes.map((scene, index) => (
          <article className="cinex-scene-card" key={scene.id}>
            <div className="cinex-scene-card-header"><strong>Scene {scene.sceneNumber}</strong><span>{scene.status} · {scene.estimatedDuration}s</span></div>
            <input value={scene.title} aria-label={`Scene ${scene.sceneNumber} title`} onChange={(event) => updateScene(index, { title: event.target.value })} />
            <textarea value={scene.summary} aria-label={`Scene ${scene.sceneNumber} summary`} onChange={(event) => updateScene(index, { summary: event.target.value })} rows={2} />
            <div className="cinex-scene-actions">
              <button type="button" className="cinex-auth-secondary" onClick={() => moveScene(index, -1)}>Move up</button>
              <button type="button" className="cinex-auth-secondary" onClick={() => moveScene(index, 1)}>Move down</button>
              <button type="button" className="cinex-auth-secondary" onClick={() => deleteScene(index)}>Delete</button>
            </div>
          </article>
        ))}
      </div>
      <div className="cinex-dashboard-actions">
        <button type="button" className="cinex-route-primary" onClick={addScene}>Add scene</button>
        <button type="button" className="cinex-auth-secondary" onClick={simulatePreview} disabled={busy}>{busy ? 'Simulating preview...' : 'Generate preview'}</button>
      </div>
      <p className="cinex-shot-plan-next">Generation setup is coming next. This is local storyboard data only.</p>
    </section>
  );
}
