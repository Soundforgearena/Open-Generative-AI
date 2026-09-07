'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import CinexRoutePage from '@/components/CinexRoutePage';
import { demoModeEnabled } from '@/lib/demo-mode';
import { getDemoProject, saveDemoProject } from '@/lib/demo-project-store';
import { getProject, updateProject, updateScene } from '@/lib/cinexvideo-client';
import { safeProjectId } from '@/lib/safe-navigation';
import AskAiDirectorButton from '@/components/AskAiDirectorButton';
import ContinuityGuardianPanel from '@/components/continuity/ContinuityGuardianPanel';
import ContinuityBibleEditor from '@/components/continuity/ContinuityBibleEditor';
import { createContinuityBible } from '@/lib/continuity/continuity-bible';

function MissingDraft() {
  return (
    <div className="cinex-missing-draft">
      <p className="cinex-form-error">We couldn&apos;t find that draft.</p>
      <div className="cinex-dashboard-actions">
        <Link href="/create" className="cinex-route-primary">Back to Create</Link>
        <Link href="/dashboard" className="cinex-route-secondary-link">Go to Dashboard</Link>
      </div>
    </div>
  );
}

function ReviewContent() {
  const searchParams = useSearchParams();
  const projectId = useMemo(() => searchParams.get('project') || '', [searchParams]);
  const [project, setProject] = useState(null);
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState('Loading your storyboard...');
  const [simulating, setSimulating] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (!safeProjectId(projectId, demoModeEnabled)) {
      setState('missing');
      return;
    }

    async function loadProject() {
      try {
        if (demoModeEnabled) {
          const localProject = getDemoProject(projectId);
          if (!localProject) {
            setState('missing');
            return;
          }
          setProject(localProject);
          setState('ready');
          return;
        }

        const result = await getProject(projectId);
        if (!result?.project) {
          setState('missing');
          return;
        }
        setProject({
          ...result.project,
          sourceText: result.project.logline || '',
          style: result.project.visual_identity?.style || 'Cinematic',
          aspectRatio: result.project.visual_identity?.aspect_ratio || '16:9',
          duration: result.scenes?.reduce((total, scene) => total + Number(scene.duration_seconds || 0), 0) || 0,
          scenes: (result.scenes || []).map((scene) => ({
            id: scene.id,
            sceneNumber: scene.position,
            title: scene.title,
            summary: scene.purpose || '',
            visualPrompt: scene.prompt || scene.shot_direction || '',
            narration: scene.narration || '',
            estimatedDuration: scene.duration_seconds,
            status: scene.status || 'Draft',
          })),
        });
        setState('ready');
      } catch (loadError) {
        setMessage(loadError.message || 'This draft could not be loaded.');
        setState('error');
      }
    }

    loadProject();
  }, [projectId]);

  function updateLocalProject(next) {
    setProject(next);
    if (demoModeEnabled) saveDemoProject(next);
  }

  async function updateSceneValue(index, patch) {
    const scene = project.scenes[index];
    const scenes = project.scenes.map((item, sceneIndex) => sceneIndex === index ? { ...item, ...patch } : item);
    updateLocalProject({ ...project, scenes });
    if (!demoModeEnabled && scene.id) {
      try {
        await updateScene(scene.id, {
          title: patch.title,
          purpose: patch.summary,
          prompt: patch.visualPrompt,
          duration_seconds: patch.estimatedDuration,
        });
      } catch {
        setMessage('Scene changed locally but could not be saved to the server.');
        setState('error');
      }
    }
  }

  function reorderScene(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= project.scenes.length) return;
    const scenes = [...project.scenes];
    [scenes[index], scenes[target]] = [scenes[target], scenes[index]];
    updateLocalProject({ ...project, scenes: scenes.map((scene, sceneIndex) => ({ ...scene, order: sceneIndex + 1, sceneNumber: sceneIndex + 1 })) });
  }

  function addScene() {
    const scenes = [...project.scenes, {
      id: `demo-scene-${Date.now()}`,
      sceneNumber: project.scenes.length + 1,
      title: 'New scene',
      summary: 'Add a new story beat.',
      visualPrompt: project.style || 'Cinematic frame',
      narration: '',
      estimatedDuration: 5,
      status: 'Draft',
    }];
    updateLocalProject({ ...project, scenes });
  }

  function deleteScene(index) {
    const scenes = project.scenes.filter((_, sceneIndex) => sceneIndex !== index).map((scene, sceneIndex) => ({ ...scene, order: sceneIndex + 1, sceneNumber: sceneIndex + 1 }));
    updateLocalProject({ ...project, scenes });
  }

  async function saveChanges() {
    if (demoModeEnabled) {
      saveDemoProject(project);
      setMessage('Saved locally.');
      return;
    }
    try {
      await updateProject(project.id, { title: project.title });
      setMessage('Saved to your project.');
    } catch {
      setMessage('The project could not be saved. Please try again.');
    }
  }

  function continueToGeneration() {
    if (!demoModeEnabled) {
      setMessage('Video generation will be available after your account is connected.');
      return;
    }
    if (simulating || completed) return;
    setSimulating(true);
    const statuses = ['queued', 'generating', 'completed'];
    statuses.forEach((status, index) => {
      window.setTimeout(() => {
        const nextProject = {
          ...project,
          status,
          scenes: project.scenes.map((scene) => ({ ...scene, status })),
        };
        updateLocalProject(nextProject);
        if (status === 'completed') {
          setCompleted(true);
          setSimulating(false);
          setMessage('Demo preview — no video was generated and no credits were used.');
        }
      }, (index + 1) * 600);
    });
  }

  return (
    <CinexRoutePage
      eyebrow="Storyboard review"
      title="Review shot plan"
      description="Edit the draft and scenes before any generation step."
    >
      {demoModeEnabled && <p className="cinex-demo-indicator">Demo mode — local data only</p>}
      {state === 'ready' && project && <ContinuityGuardianPanel project={project} onFix={() => window.location.assign('/create/director')} />}
      {state === 'ready' && project && <ContinuityBibleEditor value={project.continuityBible || createContinuityBible()} onChange={(continuityBible) => updateLocalProject({ ...project, continuityBible })} />}
      {state === 'loading' && <p className="cinex-form-success" role="status">{message}</p>}
      {state === 'error' && <p className="cinex-form-error" role="alert">{message}</p>}
      {state === 'missing' && <MissingDraft />}
      {state === 'ready' && project && (
        <div className="cinex-review-layout">
          <section className="cinex-review-summary" aria-labelledby="review-project-title">
            <label>
              Project title
              <input value={project.title || ''} onChange={(event) => updateLocalProject({ ...project, title: event.target.value })} />
              <AskAiDirectorButton fieldType="title" value={project.title} context={{ sourceType: project.sourceType, style: project.style, duration: project.duration }} onApply={(suggestion) => updateLocalProject({ ...project, title: suggestion.split('\n')[0] })} />
            </label>
            <dl>
              <div><dt>Source idea</dt><dd>{project.sourceText || project.logline || 'Not specified'}</dd></div>
              <div><dt>Style</dt><dd>{project.style || 'Cinematic'}</dd></div>
              <div><dt>Duration</dt><dd>{project.duration || 'Not specified'} seconds</dd></div>
              <div><dt>Visual notes</dt><dd>{project.notes || 'No visual notes added.'}</dd></div>
            </dl>
            <AskAiDirectorButton fieldType="story" value={project.sourceText || project.logline} context={{ sourceType: project.sourceType, style: project.style, duration: project.duration }} onApply={(suggestion) => updateLocalProject({ ...project, sourceText: suggestion })} />
            <div className="cinex-dashboard-actions">
              <button type="button" className="cinex-route-primary" onClick={continueToGeneration} disabled={simulating || completed}>{simulating ? 'Simulating generation...' : completed ? 'Generation simulation complete' : demoModeEnabled ? 'Simulate Generation' : 'Continue to Generation'}</button>
              <button type="button" className="cinex-auth-secondary" onClick={saveChanges}>Save changes</button>
            </div>
            <Link href="/create/director" className="cinex-route-secondary-link">Open AI Director Writing Room</Link>
            {message && <p className="cinex-form-success" role="status">{message}</p>}
            {completed && <Link href={`/projects/${encodeURIComponent(project.id)}`} className="cinex-route-secondary-link">View completed project</Link>}
          </section>
          <section className="cinex-shot-plan" aria-labelledby="review-project-title">
            <p className="cinex-shot-plan-eyebrow">Storyboard preview</p>
            <h2 id="review-project-title">{project.title}</h2>
            <div className="cinex-scene-list">
              {project.scenes.map((scene, index) => (
                <article className="cinex-scene-card" key={scene.id || index}>
                  <div className="cinex-scene-card-header"><strong>Scene {scene.sceneNumber}</strong><span>{scene.estimatedDuration}s · {scene.status}</span></div>
                  <input value={scene.title || ''} aria-label={`Scene ${scene.sceneNumber} title`} onChange={(event) => updateSceneValue(index, { title: event.target.value })} />
                  <AskAiDirectorButton fieldType="scene" value={scene.title} context={{ sceneContext: scene.summary, style: project.style, duration: scene.estimatedDuration }} onApply={(suggestion) => updateSceneValue(index, { title: suggestion.split('\n')[0] })} />
                  <textarea value={scene.summary || ''} aria-label={`Scene ${scene.sceneNumber} summary`} onChange={(event) => updateSceneValue(index, { summary: event.target.value })} rows={2} />
                  <AskAiDirectorButton fieldType="scene" value={scene.summary} context={{ sceneContext: scene.title, style: project.style, duration: scene.estimatedDuration }} onApply={(suggestion) => updateSceneValue(index, { summary: suggestion })} />
                  <p><strong>Visual prompt:</strong> {scene.visualPrompt || 'Not specified'}</p>
                  <AskAiDirectorButton fieldType="visualNotes" value={scene.visualPrompt} context={{ sceneContext: scene.summary, style: project.style, duration: scene.estimatedDuration }} onApply={(suggestion) => updateSceneValue(index, { visualPrompt: suggestion })} />
                  <p><strong>Narration/dialogue:</strong> {scene.narration || 'None'}</p>
                  <AskAiDirectorButton fieldType="scene" value={scene.narration} context={{ sceneContext: scene.summary, style: project.style, duration: scene.estimatedDuration }} onApply={(suggestion) => updateSceneValue(index, { narration: suggestion })} />
                  <div className="cinex-scene-actions">
                    {demoModeEnabled && <>
                      <button type="button" className="cinex-auth-secondary" onClick={() => reorderScene(index, -1)}>Move up</button>
                      <button type="button" className="cinex-auth-secondary" onClick={() => reorderScene(index, 1)}>Move down</button>
                      <button type="button" className="cinex-auth-secondary" onClick={() => deleteScene(index)}>Delete</button>
                    </>}
                  </div>
                </article>
              ))}
            </div>
            {demoModeEnabled && <button type="button" className="cinex-route-primary" onClick={addScene}>Add scene</button>}
          </section>
        </div>
      )}
    </CinexRoutePage>
  );
}

export default function ReviewPage() {
  return <Suspense fallback={<main className="cinex-dashboard-loading">Loading draft review...</main>}><ReviewContent /></Suspense>;
}
