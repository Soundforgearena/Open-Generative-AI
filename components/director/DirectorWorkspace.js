'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  createProject,
  getAccount,
  getCatalog,
  getProject,
  quoteExport,
  confirmExport,
  quoteGeneration,
  requestDirectorPlan,
  startGeneration,
  updateProject,
  updateScene,
  waitForJob,
} from '@/lib/cinexvideo-client';
import {
  buildDirectorPlanPatch,
  generationGate,
  normalizeDirectorWorkflow,
} from '@/lib/director-workflow';
import styles from './DirectorWorkspace.module.css';

const LANE_LABELS = {
  music_video: 'Music Video',
  episode: 'Episode',
};

function mapProject(result) {
  const scenes = (result.scenes || []).map((scene) => {
    const versions = scene.versions || [];
    const approved = versions.find((version) => version.approved);
    const latest = versions[0] || null;
    return {
      id: scene.id,
      title: scene.title || '',
      purpose: scene.purpose || '',
      prompt: scene.prompt || '',
      shot_direction: scene.shot_direction || '',
      duration_seconds: Number(scene.duration_seconds || 8),
      continuity_locked: Boolean(scene.continuity_locked),
      status: scene.status || 'draft',
      position: scene.position || 1,
      active_version: scene.active_version,
      preview_url: approved?.output_url || latest?.output_url || '',
      quality: approved ? 'approved' : latest?.status === 'completed' ? 'review' : 'draft',
      warning: scene.continuity_locked ? '' : 'Continuity not locked',
    };
  });
  return {
    ...result.project,
    scenes,
    assets: result.assets || [],
  };
}

export default function DirectorWorkspace({ initialLane = 'music_video', allowLaneSwitch = true }) {
  const params = useSearchParams();
  const [lane, setLane] = useState(initialLane);
  const [project, setProject] = useState(null);
  const [sceneId, setSceneId] = useState('');
  const [workflow, setWorkflow] = useState(() => normalizeDirectorWorkflow(initialLane, null));
  const [account, setAccount] = useState(null);
  const [videoOption, setVideoOption] = useState(null);
  const [status, setStatus] = useState('Loading Director workspace...');
  const [busy, setBusy] = useState(false);
  const [planningPrompt, setPlanningPrompt] = useState('');
  const [inspectorTab, setInspectorTab] = useState('inspector');
  const [flightPathTab, setFlightPathTab] = useState('visual');
  const [quote, setQuote] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const [accountData, catalog] = await Promise.all([getAccount(), getCatalog()]);
        if (cancelled) return;
        setAccount(accountData);
        setVideoOption((catalog.options || []).find((option) => option.operation === 'video') || null);
      } catch (error) {
        if (!cancelled) setStatus(error.message || 'Director workspace could not load account settings.');
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadProjectData() {
      const projectId = params.get('project');
      if (!projectId) {
        setProject(null);
        setSceneId('');
        setWorkflow(normalizeDirectorWorkflow(lane, null));
        setStatus('Start with a lane prompt to create a production project.');
        return;
      }
      try {
        const result = await getProject(projectId);
        if (cancelled) return;
        const mapped = mapProject(result);
        setProject(mapped);
        setLane(mapped.lane || lane);
        setSceneId(mapped.scenes[0]?.id || '');
        setWorkflow(normalizeDirectorWorkflow(mapped.lane || lane, mapped.director_plan));
        setStatus('');
      } catch (error) {
        if (!cancelled) {
          setStatus(error.message || 'Project could not be loaded.');
          setProject(null);
        }
      }
    }
    loadProjectData();
    return () => {
      cancelled = true;
    };
  }, [params, lane]);

  const scenes = useMemo(() => project?.scenes || [], [project]);
  const selectedScene = useMemo(
    () => scenes.find((item) => item.id === sceneId) || scenes[0] || null,
    [scenes, sceneId]
  );
  const totalSeconds = scenes.reduce((sum, scene) => sum + Number(scene.duration_seconds || 0), 0);

  const gate = generationGate({
    lane,
    workflow,
    selectedSceneId: selectedScene?.id,
    videoOption,
    configMessage: status.includes('settings')
      ? 'Generation is disabled: account configuration is unavailable right now.'
      : '',
  });

  function touchWorkflow(next) {
    if (lane === 'music_video') {
      next.approval_locked = false;
      next.approved_at = null;
    } else {
      next.greenlit = false;
      next.greenlit_at = null;
    }
    return next;
  }

  function updateWorkflowField(field, value) {
    setWorkflow((current) => touchWorkflow({ ...current, [field]: value }));
  }

  function updateSceneLocal(scenePatch) {
    if (!selectedScene) return;
    setProject((current) => ({
      ...current,
      scenes: current.scenes.map((scene) =>
        scene.id === selectedScene.id ? { ...scene, ...scenePatch } : scene
      ),
    }));
    setWorkflow((current) => touchWorkflow({ ...current }));
  }

  async function savePlan() {
    if (!project?.id) return;
    setBusy(true);
    setStatus('Saving director plan...');
    try {
      const directorPlan = buildDirectorPlanPatch({
        lane,
        workflow,
        existingPlan: project.director_plan,
      });
      await updateProject(project.id, {
        title: project.title,
        logline: project.logline,
        visual_identity: project.visual_identity || {},
        director_plan: directorPlan,
      });
      setProject((current) => ({ ...current, director_plan: directorPlan }));
      setStatus('Director plan saved.');
    } catch (error) {
      setStatus(error.message || 'Could not save the director plan.');
    } finally {
      setBusy(false);
    }
  }

  async function saveScene() {
    if (!selectedScene?.id) return;
    setBusy(true);
    setStatus(`Saving Scene ${selectedScene.position}...`);
    try {
      await updateScene(selectedScene.id, {
        title: selectedScene.title,
        purpose: selectedScene.purpose,
        prompt: selectedScene.prompt,
        shot_direction: selectedScene.shot_direction,
        duration_seconds: Number(selectedScene.duration_seconds),
        continuity_locked: Boolean(selectedScene.continuity_locked),
      });
      setStatus(`Scene ${selectedScene.position} saved.`);
    } catch (error) {
      setStatus(error.message || 'Could not save this scene.');
    } finally {
      setBusy(false);
    }
  }

  async function approvePlan() {
    if (!project?.id) return;
    const now = new Date().toISOString();
    const next = lane === 'music_video'
      ? { ...workflow, approval_locked: true, approved_at: now }
      : { ...workflow, greenlit: true, greenlit_at: now };
    setWorkflow(next);
    setBusy(true);
    setStatus(lane === 'music_video' ? 'Locking music-video plan...' : 'Applying episode greenlight...');
    try {
      const directorPlan = buildDirectorPlanPatch({ lane, workflow: next, existingPlan: project.director_plan });
      await updateProject(project.id, { director_plan: directorPlan, status: 'in_production' });
      setProject((current) => ({ ...current, director_plan: directorPlan, status: 'in_production' }));
      setStatus(lane === 'music_video' ? 'Plan approved and locked for generation.' : 'Episode greenlight confirmed.');
    } catch (error) {
      setStatus(error.message || 'Approval could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function createFromPrompt() {
    if (!planningPrompt.trim()) return;
    setBusy(true);
    setStatus('Building director treatment and scene plan...');
    try {
      const plan = await requestDirectorPlan(planningPrompt, lane);
      const created = await createProject({ lane, title: plan.creative_title, plan });
      window.location.assign(`/${lane === 'music_video' ? 'music-video' : 'episode'}/director?project=${encodeURIComponent(created.project_id)}`);
    } catch (error) {
      setStatus(error.message || 'Project could not be created from the plan.');
      setBusy(false);
    }
  }

  function generationPayload() {
    if (!project || !selectedScene || !videoOption) return null;
    const duration = Math.min(
      Math.max(1, Number(selectedScene.duration_seconds || 1)),
      Number(videoOption.max_duration_seconds || selectedScene.duration_seconds || 8)
    );
    return {
      model: videoOption.model,
      operation: 'video',
      project_id: project.id,
      scene_id: selectedScene.id,
      duration_seconds: duration,
      input: {
        prompt: selectedScene.prompt || selectedScene.purpose || selectedScene.title,
        duration,
        aspect_ratio: project.visual_identity?.aspect_ratio || '16:9',
      },
    };
  }

  async function estimateGeneration() {
    const payload = generationPayload();
    if (!payload || !gate.allowed) {
      setStatus(gate.reason);
      return;
    }
    setBusy(true);
    setStatus('Calculating generation estimate...');
    try {
      const nextQuote = await quoteGeneration(payload);
      setQuote(nextQuote);
      setShowConfirm(true);
      setStatus('Review estimate and confirm generation.');
    } catch (error) {
      setStatus(error.message || 'Estimate unavailable.');
    } finally {
      setBusy(false);
    }
  }

  async function runGeneration() {
    const payload = generationPayload();
    if (!payload || !quote) return;
    setShowConfirm(false);
    setBusy(true);
    setStatus('Submitting generation with reserved credits...');
    try {
      const started = await startGeneration({ ...payload, confirmed_max_credits: Number(quote.credits_required || 0) });
      setProject((current) => ({
        ...current,
        scenes: current.scenes.map((scene) =>
          scene.id === selectedScene.id ? { ...scene, status: 'running' } : scene
        ),
      }));
      const result = await waitForJob(started.request_id, {
        onTick: (tick) => {
          setProject((current) => ({
            ...current,
            scenes: current.scenes.map((scene) =>
              scene.id === selectedScene.id ? { ...scene, status: tick.status } : scene
            ),
          }));
        },
      });
      setStatus(result.status === 'completed'
        ? 'Generation completed. Review and approve the new take in scene versions.'
        : 'Generation failed. Reservation was released by the server.');
    } catch (error) {
      setStatus(error.message || 'Generation could not be started.');
    } finally {
      setBusy(false);
    }
  }

  async function runStoryboardExport() {
    if (!project?.id) return;
    setBusy(true);
    setStatus('Preparing storyboard export estimate...');
    try {
      const quoted = await quoteExport({ project_id: project.id, export_type: 'storyboard' });
      const result = await confirmExport({ project_id: project.id, export_type: 'storyboard' });
      setStatus(`Storyboard export complete (${quoted.credits_required} credits). Download is ready now.`);
      if (result.download_url) window.open(result.download_url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setStatus(error.message || 'Storyboard export could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  const laneBadge = lane === 'music_video' ? 'Music video lane' : 'Episode lane';

  return (
    <main className={styles.shell}>
      <header className={styles.topBar}>
        <div>
          <p className={styles.brand}>Cinex Video AI Director</p>
          <strong>{project?.title || 'Director workspace'}</strong>
          <p className={styles.subtle}>{project ? `Project status: ${project.status || 'draft'}` : 'No project selected'}</p>
        </div>
        {allowLaneSwitch && (
          <div className={styles.laneSwitch} role="tablist" aria-label="Director lane">
            {Object.entries(LANE_LABELS).map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={lane === value} className={lane === value ? styles.activeLane : ''} onClick={() => setLane(value)}>
                {label}
              </button>
            ))}
          </div>
        )}
        <div className={styles.creditsBox}>
          <span>{laneBadge}</span>
          <span>Credits: {account?.credits ?? '—'}</span>
          <span>{videoOption ? `Model: ${videoOption.label}` : 'Model: not configured'}</span>
        </div>
      </header>

      {!project && (
        <section className={styles.newProject}>
          <h1>{lane === 'music_video' ? 'Start a Music Video Director project' : 'Start an Episode Studio project'}</h1>
          <p>
            {lane === 'music_video'
              ? 'Create treatment, style bible, beat map, storyboard, and continuity metadata in one production workflow.'
              : 'Capture premise, treatment or screenplay, cast and world, references, runtime, scene breakdown, continuity bible, and shot plan.'}
          </p>
          <textarea value={planningPrompt} onChange={(event) => setPlanningPrompt(event.target.value)} rows={5} placeholder={lane === 'music_video' ? 'Describe your song, mood, and visual identity.' : 'Describe your episode premise or paste a screenplay excerpt.'} />
          <div className={styles.rowActions}>
            <button type="button" onClick={createFromPrompt} disabled={busy || !planningPrompt.trim()}>{busy ? 'Building plan...' : 'Generate director plan'}</button>
            <Link href="/dashboard">Back to dashboard</Link>
          </div>
        </section>
      )}

      {project && (
        <div className={styles.layout}>
          <aside className={styles.sceneRail}>
            <h2>Scene Rail</h2>
            {scenes.map((scene) => (
              <button key={scene.id} type="button" className={scene.id === selectedScene?.id ? styles.sceneActive : styles.sceneCard} onClick={() => setSceneId(scene.id)}>
                <span className={styles.thumb} style={scene.preview_url ? { backgroundImage: `linear-gradient(rgba(14,14,14,.45),rgba(14,14,14,.7)),url(${scene.preview_url})` } : undefined} />
                <strong>{scene.position}. {scene.title || `Scene ${scene.position}`}</strong>
                <small>{scene.duration_seconds}s · {scene.status}</small>
                {scene.warning && <em>{scene.warning}</em>}
              </button>
            ))}
          </aside>

          <section className={styles.monitor}>
            <div className={styles.monitorFrame}>
              <div className={styles.overlayText}>
                <p>{selectedScene?.title || 'Select a scene'}</p>
                <span>{selectedScene?.purpose || 'No scene purpose yet.'}</span>
              </div>
            </div>
            <div className={styles.transport}>
              <button type="button">⏮</button>
              <button type="button">▶</button>
              <button type="button">⏸</button>
              <button type="button">⏭</button>
              <span>{totalSeconds}s total</span>
            </div>
            <article className={styles.promptCard}>
              <h3>AI Prompt</h3>
              <textarea value={selectedScene?.prompt || ''} onChange={(event) => updateSceneLocal({ prompt: event.target.value })} rows={4} placeholder="Describe the cinematic frame, subject motion, and key visual constraints." />
              <div className={styles.rowActions}>
                <button type="button" onClick={saveScene} disabled={busy || !selectedScene}>Save shot controls</button>
                <label><input type="checkbox" checked={Boolean(selectedScene?.continuity_locked)} onChange={(event) => updateSceneLocal({ continuity_locked: event.target.checked })} /> Continuity lock</label>
              </div>
            </article>
          </section>

          <aside className={styles.inspector}>
            <div className={styles.tabRow}>
              <button type="button" className={inspectorTab === 'inspector' ? styles.activeLane : ''} onClick={() => setInspectorTab('inspector')}>Inspector</button>
              <button type="button" className={inspectorTab === 'assets' ? styles.activeLane : ''} onClick={() => setInspectorTab('assets')}>Assets</button>
            </div>
            {inspectorTab === 'assets' ? (
              <ul className={styles.assetList}>
                {project.assets.length ? project.assets.map((asset) => <li key={asset.id}><strong>{asset.kind}</strong><span>{asset.name}</span></li>) : <li>No assets uploaded yet.</li>}
              </ul>
            ) : (
              <div className={styles.panelStack}>
                <h3>Visual Direction</h3>
                {lane === 'music_video' ? (
                  <>
                    <label>Treatment<textarea rows={3} value={workflow.treatment || ''} onChange={(event) => updateWorkflowField('treatment', event.target.value)} /></label>
                    <label>Style Bible<textarea rows={3} value={workflow.style_bible || ''} onChange={(event) => updateWorkflowField('style_bible', event.target.value)} /></label>
                    <label>Beat Map<textarea rows={3} value={workflow.beat_map || ''} onChange={(event) => updateWorkflowField('beat_map', event.target.value)} /></label>
                    <label>Storyboard / Shot Plan<textarea rows={3} value={workflow.storyboard_notes || ''} onChange={(event) => updateWorkflowField('storyboard_notes', event.target.value)} /></label>
                    <label>Continuity Metadata<textarea rows={3} value={workflow.continuity_metadata || ''} onChange={(event) => updateWorkflowField('continuity_metadata', event.target.value)} /></label>
                  </>
                ) : (
                  <>
                    <label>Premise<textarea rows={2} value={workflow.premise || ''} onChange={(event) => updateWorkflowField('premise', event.target.value)} /></label>
                    <label>Treatment<textarea rows={3} value={workflow.treatment || ''} onChange={(event) => updateWorkflowField('treatment', event.target.value)} /></label>
                    <label>Screenplay<textarea rows={4} value={workflow.screenplay || ''} onChange={(event) => updateWorkflowField('screenplay', event.target.value)} /></label>
                    <label>Cast / World<textarea rows={3} value={workflow.cast_world || ''} onChange={(event) => updateWorkflowField('cast_world', event.target.value)} /></label>
                    <label>References<textarea rows={2} value={workflow.references || ''} onChange={(event) => updateWorkflowField('references', event.target.value)} /></label>
                    <label>Runtime (minutes)<input type="number" min="1" max="240" value={workflow.runtime_minutes || 24} onChange={(event) => updateWorkflowField('runtime_minutes', event.target.value)} /></label>
                    <label>Scene Breakdown<textarea rows={3} value={workflow.scene_breakdown || ''} onChange={(event) => updateWorkflowField('scene_breakdown', event.target.value)} /></label>
                    <label>Continuity Bible<textarea rows={3} value={workflow.continuity_bible || ''} onChange={(event) => updateWorkflowField('continuity_bible', event.target.value)} /></label>
                    <label>Shot Plan<textarea rows={3} value={workflow.shot_plan || ''} onChange={(event) => updateWorkflowField('shot_plan', event.target.value)} /></label>
                  </>
                )}
                <label>Camera<textarea rows={2} value={selectedScene?.shot_direction || ''} onChange={(event) => updateSceneLocal({ shot_direction: event.target.value })} /></label>
                <label>Audio Sync<textarea rows={2} value={selectedScene?.purpose || ''} onChange={(event) => updateSceneLocal({ purpose: event.target.value })} /></label>
                <div className={styles.rowActions}>
                  <button type="button" onClick={savePlan} disabled={busy}>Save {lane === 'music_video' ? 'music plan' : 'episode plan'}</button>
                  <button type="button" onClick={approvePlan} disabled={busy}>{lane === 'music_video' ? 'Approve & lock' : 'Greenlight episode'}</button>
                </div>
                <div className={styles.generationBox}>
                  <h3>Generation</h3>
                  <p>{gate.allowed ? 'Ready after estimate confirmation.' : gate.reason}</p>
                  <button type="button" onClick={estimateGeneration} disabled={busy || !gate.allowed}>Estimate & confirm generate</button>
                  <button type="button" onClick={runStoryboardExport} disabled={busy}>Export storyboard</button>
                </div>
              </div>
            )}
          </aside>

          <section className={styles.flightPath}>
            <header>
              <h2>Director&apos;s Flight Path</h2>
              <div className={styles.tabRow}>
                <button type="button" className={flightPathTab === 'visual' ? styles.activeLane : ''} onClick={() => setFlightPathTab('visual')}>Visual Direction</button>
                <button type="button" className={flightPathTab === 'camera' ? styles.activeLane : ''} onClick={() => setFlightPathTab('camera')}>Camera</button>
                <button type="button" className={flightPathTab === 'continuity' ? styles.activeLane : ''} onClick={() => setFlightPathTab('continuity')}>Continuity</button>
                <button type="button" className={flightPathTab === 'audio' ? styles.activeLane : ''} onClick={() => setFlightPathTab('audio')}>Audio Sync</button>
              </div>
            </header>
            <div className={styles.timeline}>
              {scenes.map((scene) => (
                <button key={scene.id} type="button" onClick={() => setSceneId(scene.id)} className={scene.id === selectedScene?.id ? styles.clipActive : styles.clipCard}>
                  <strong>{scene.title || `Scene ${scene.position}`}</strong>
                  <span>{scene.duration_seconds}s</span>
                  <small>Quality: {scene.quality}</small>
                  <small>{scene.warning || 'No blocking warnings'}</small>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {status && <p className={styles.status}>{status}</p>}

      {showConfirm && quote && (
        <div className={styles.confirmBackdrop}>
          <section className={styles.confirmDialog} role="dialog" aria-modal="true" aria-labelledby="director-generate-confirm">
            <h2 id="director-generate-confirm">Confirm generation</h2>
            <p>Estimated maximum debit: {Number(quote.credits_required || 0)} credits.</p>
            <p>The server reserves credits atomically and settles actual cost on completion.</p>
            <div className={styles.rowActions}>
              <button type="button" onClick={runGeneration}>Start generation</button>
              <button type="button" onClick={() => setShowConfirm(false)}>Cancel</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
