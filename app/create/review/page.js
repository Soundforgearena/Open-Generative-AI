'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import CinexRoutePage from '@/components/CinexRoutePage';
import { demoModeEnabled } from '@/lib/demo-mode';
import { getDemoProject, saveDemoProject } from '@/lib/demo-project-store';
import {
  getCatalog,
  getProject,
  quoteGeneration,
  startGeneration,
  updateProject,
  updateScene,
  waitForJob,
} from '@/lib/cinexvideo-client';
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
  const [videoOption, setVideoOption] = useState(null);
  const [showGenerationConfirm, setShowGenerationConfirm] = useState(false);
  const [generationQuote, setGenerationQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const sceneSaveQueues = useRef(new Map());

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

        const [result, catalog] = await Promise.all([getProject(projectId), getCatalog()]);
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
        setVideoOption((catalog.options || []).find((option) => option.operation === 'video') || null);
        setState('ready');
      } catch (loadError) {
        setMessage(loadError.message || 'This draft could not be loaded.');
        setState('error');
      }
    }

    loadProject();
  }, [projectId]);

  useEffect(() => {
    if (!showGenerationConfirm) return undefined;
    function closeConfirmation(event) {
      if (event.key === 'Escape') setShowGenerationConfirm(false);
    }
    document.addEventListener('keydown', closeConfirmation);
    return () => document.removeEventListener('keydown', closeConfirmation);
  }, [showGenerationConfirm]);

  function updateLocalProject(next) {
    setProject(next);
    if (demoModeEnabled) saveDemoProject(next);
  }

  function updateSceneValue(index, patch) {
    const scenes = project.scenes.map((item, sceneIndex) => sceneIndex === index ? { ...item, ...patch } : item);
    updateLocalProject({ ...project, scenes });
  }

  async function persistSceneValue(index, patch) {
    const scene = project.scenes[index];
    if (demoModeEnabled || !scene?.id) return;
    if (Object.hasOwn(patch, 'title') && !String(patch.title || '').trim()) return;
    const previous = sceneSaveQueues.current.get(scene.id) || Promise.resolve();
    const queued = previous
      .catch(() => undefined)
      .then(() => updateScene(scene.id, patch))
      .then(() => setMessage(`Scene ${scene.sceneNumber} saved.`))
      .catch((saveError) => {
        setMessage(saveError.message || 'Scene changed locally but could not be saved to the server.');
      });
    sceneSaveQueues.current.set(scene.id, queued);
    await queued;
    if (sceneSaveQueues.current.get(scene.id) === queued) {
      sceneSaveQueues.current.delete(scene.id);
    }
  }

  function generationPayload(scene) {
    const duration = Math.min(
      Number(scene.estimatedDuration || 5),
      Number(videoOption?.max_duration_seconds || 10)
    );
    return {
      model: videoOption.model,
      operation: 'video',
      project_id: project.id,
      scene_id: scene.id,
      duration_seconds: duration,
      input: {
        prompt: scene.visualPrompt || scene.summary || scene.title,
        aspect_ratio: project.aspectRatio || '16:9',
        duration,
      },
    };
  }

  async function prepareGeneration() {
    if (demoModeEnabled) {
      await continueToGeneration();
      return;
    }
    if (quoting || simulating || completed || !videoOption) return;
    setQuoting(true);
    setMessage('Calculating the exact generation total...');
    try {
      const quotedScenes = await Promise.all(
        project.scenes.map(async (scene) => {
          const quote = await quoteGeneration(generationPayload(scene));
          return { sceneId: scene.id, credits: Number(quote.credits_required) };
        })
      );
      setGenerationQuote({
        byScene: Object.fromEntries(quotedScenes.map((item) => [item.sceneId, item.credits])),
        totalCredits: quotedScenes.reduce((total, item) => total + item.credits, 0),
      });
      setMessage('');
      setShowGenerationConfirm(true);
    } catch (quoteError) {
      setMessage(quoteError.message || 'The generation price could not be calculated.');
    } finally {
      setQuoting(false);
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

  async function continueToGeneration() {
    if (!demoModeEnabled) {
      if (simulating || completed || !videoOption || !generationQuote) return;
      setSimulating(true);
      setShowGenerationConfirm(false);
      setMessage('Starting scene generation...');
      try {
        const results = [];
        for (const scene of project.scenes) {
          const job = await startGeneration({
            ...generationPayload(scene),
            confirmed_max_credits: generationQuote.byScene[scene.id],
          });
          setProject((current) => ({
            ...current,
            scenes: current.scenes.map((item) =>
              item.id === scene.id ? { ...item, status: 'running' } : item
            ),
          }));
          setMessage(`Generating scene ${scene.sceneNumber} of ${project.scenes.length}...`);
          const result = await waitForJob(job.request_id, {
            onTick: (tick) => setProject((current) => ({
              ...current,
              scenes: current.scenes.map((item) =>
                item.id === scene.id ? { ...item, status: tick.status } : item
              ),
            })),
          });
          results.push(result);
        }
        const failedCount = results.filter((result) => result.status === 'failed').length;
        if (failedCount > 0) {
          setMessage(
            `${failedCount} scene${failedCount === 1 ? '' : 's'} failed to generate. Credits for failed scenes were returned; retry those scenes from the project.`
          );
        } else {
          setCompleted(true);
          setMessage('Generation complete. Your scene versions are ready for review.');
        }
      } catch (generationError) {
        setMessage(
          generationError.status === 402
            ? 'You need more credits to generate these scenes. Open Account and billing to continue.'
            : generationError.message || 'Generation could not be started.'
        );
      } finally {
        setSimulating(false);
      }
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
      {state === 'ready' && project && <ContinuityGuardianPanel project={project} onFix={() => window.location.assign('/create/director')} onGenerate={prepareGeneration} />}
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
              <button type="button" className="cinex-route-primary" onClick={prepareGeneration} disabled={quoting || simulating || completed || (!demoModeEnabled && !videoOption)}>{quoting ? 'Calculating total...' : simulating ? 'Generating scenes...' : completed ? 'Generation complete' : demoModeEnabled ? 'Simulate Generation' : videoOption ? 'Review generation' : 'No video model available'}</button>
              <button type="button" className="cinex-auth-secondary" onClick={saveChanges}>Save changes</button>
              {!demoModeEnabled && <Link href="/account" className="cinex-route-secondary-link">Account and billing</Link>}
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
                  <input value={scene.title || ''} aria-label={`Scene ${scene.sceneNumber} title`} onChange={(event) => updateSceneValue(index, { title: event.target.value })} onBlur={() => persistSceneValue(index, { title: project.scenes[index].title })} />
                  <AskAiDirectorButton fieldType="scene" value={scene.title} context={{ sceneContext: scene.summary, style: project.style, duration: scene.estimatedDuration }} onApply={(suggestion) => { const title = suggestion.split('\n')[0]; updateSceneValue(index, { title }); persistSceneValue(index, { title }); }} />
                  <textarea value={scene.summary || ''} aria-label={`Scene ${scene.sceneNumber} summary`} onChange={(event) => updateSceneValue(index, { summary: event.target.value })} onBlur={() => persistSceneValue(index, { purpose: project.scenes[index].summary })} rows={2} />
                  <AskAiDirectorButton fieldType="scene" value={scene.summary} context={{ sceneContext: scene.title, style: project.style, duration: scene.estimatedDuration }} onApply={(suggestion) => { updateSceneValue(index, { summary: suggestion }); persistSceneValue(index, { purpose: suggestion }); }} />
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
      {state === 'ready' && project && showGenerationConfirm && !demoModeEnabled && (
        <div className="cinex-confirm-backdrop" role="presentation">
          <section className="cinex-generation-confirm" role="dialog" aria-modal="true" aria-labelledby="generation-confirm-title">
            <p className="cinex-shot-plan-eyebrow">Final confirmation</p>
            <h2 id="generation-confirm-title">Start paid generation?</h2>
            <p>
              This will submit {project.scenes.length} scene{project.scenes.length === 1 ? '' : 's'} to {videoOption?.label || 'the selected video model'}.
              Credits are reserved separately for each scene and returned automatically if a scene cannot be started.
            </p>
            <dl className="cinex-review-facts">
              <div><dt>Scenes</dt><dd>{project.scenes.length}</dd></div>
              <div><dt>Total duration</dt><dd>{project.scenes.reduce((total, scene) => total + Number(scene.estimatedDuration || 0), 0)} seconds</dd></div>
              <div><dt>Maximum debit</dt><dd>{generationQuote?.totalCredits ?? 0} credits</dd></div>
            </dl>
            <div className="cinex-dashboard-actions">
              <button type="button" className="cinex-route-primary" onClick={continueToGeneration}>Start generation</button>
              <button type="button" className="cinex-auth-secondary" autoFocus onClick={() => setShowGenerationConfirm(false)}>Cancel</button>
            </div>
          </section>
        </div>
      )}
    </CinexRoutePage>
  );
}

export default function ReviewPage() {
  return <Suspense fallback={<main className="cinex-dashboard-loading">Loading draft review...</main>}><ReviewContent /></Suspense>;
}
