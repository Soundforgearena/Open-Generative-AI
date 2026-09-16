'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  getProject,
  updateScene,
  startGeneration,
  waitForJob,
  buildDirectorPlanPatch,
  normalizeDirectorWorkflow,
  generationPayload,
  generationGate,
} from '../../lib/director-workflow';

const LANE_LABELS = {
  music_video: 'Music Video',
  episode: 'Episode',
};

const IMAGE_EXT_RE = /\.(avif|bmp|gif|jpe?g|png|svg|webp)(\?.*)?$/i;
const VIDEO_EXT_RE = /\.(m3u8|m4v|mov|mp4|ogv|webm)(\?.*)?$/i;

function safePreviewUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function mediaTypeFor(url) {
  if (!url) return '';
  if (IMAGE_EXT_RE.test(url)) return 'image';
  if (VIDEO_EXT_RE.test(url)) return 'video';
  return '';
}

function ScenePreview({ scene, className, alt }) {
  const thumbnailUrl = scene?.preview_thumbnail_url || '';
  const outputUrl = scene?.preview_output_url || '';
  const mediaType = scene?.preview_media_type || '';
  const src = thumbnailUrl || outputUrl;
  if (!src) return <span className={className} aria-hidden="true" />;
  if (thumbnailUrl || mediaType === 'image') {
    return <img className={className} src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" />;
  }
  return <video className={className} src={src} muted playsInline preload="metadata" aria-label={alt} />;
}

function mapProject(result) {
  const scenes = (result.scenes || []).map((scene) => {
    const versions = scene.versions || [];
    const approved = versions.find((version) => version.approved);
    const latest = versions[0] || null;
    const previewOutput = safePreviewUrl(approved?.output_url || latest?.output_url || '');
    const previewThumbnail = safePreviewUrl(approved?.thumbnail_url || latest?.thumbnail_url || '');
    return {
      id: scene.id,
      title: scene.title || '',
      purpose: scene.purpose || '',
      audio_sync: scene.audio_sync || '',
      prompt: scene.prompt || '',
      shot_direction: scene.shot_direction || '',
      duration_seconds: Number(scene.duration_seconds || 8),
      continuity_locked: Boolean(scene.continuity_locked),
      status: scene.status || 'draft',
      position: scene.position || 1,
      active_version: scene.active_version,
      preview_url: previewThumbnail || previewOutput,
      preview_thumbnail_url: previewThumbnail,
      preview_output_url: previewOutput,
      preview_media_type: mediaTypeFor(previewOutput),
      quality: approved ? 'approved' : latest?.status === 'completed' ? 'review' : 'draft',
      warning: scene.continuity_locked ? '' : 'Continuity not locked',
    };
  });
  return {
    id: result.id,
    title: result.title || '',
    lane: result.lane || 'music_video',
    director_plan: result.director_plan || null,
    scenes,
  };
}

export default function DirectorWorkspace({ initialLane = 'music_video', allowLaneSwitch = true }) {
  const search = useSearchParams();
  const initialProjectId = search.get('project');
  const [lane, setLane] = useState(initialLane);
  const [project, setProject] = useState(null);
  const [workflow, setWorkflow] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [sceneId, setSceneId] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [flightPathTab, setFlightPathTab] = useState('visual');
  const [quote, setQuote] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [generationState, setGenerationState] = useState('idle');
  const generationInFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!initialProjectId) return;
      const result = await getProject(initialProjectId);
      if (cancelled) return;
      const mapped = mapProject(result);
      setProject(mapped);
      setWorkflow(normalizeDirectorWorkflow(mapped.lane || lane, mapped.director_plan));
      setScenes(mapped.scenes);
      setSceneId(mapped.scenes[0]?.id || '');
    }
    load();
    return () => { cancelled = true; };
  }, [initialProjectId, lane]);

  const selectedScene = useMemo(() => scenes.find((s) => s.id === sceneId), [scenes, sceneId]);

  function updateSceneLocal(patch) {
    if (!selectedScene) return;
    setScenes((current) => current.map((s) => (s.id === selectedScene.id ? { ...s, ...patch } : s)));
  }

  async function savePlan() {
    if (!project?.id || !workflow) return;
    setBusy(true);
    setStatus(`Saving ${lane === 'music_video' ? 'music' : 'episode'} plan...`);
    try {
      const directorPlan = buildDirectorPlanPatch({ lane, workflow, existingPlan: project.director_plan });
      await updateScene(selectedScene.id, { director_plan: directorPlan });
      setProject((current) => ({ ...current, director_plan: directorPlan }));
      setStatus(`Plan saved.`);
    } catch (error) {
      setStatus(error.message || 'Could not save this plan.');
    } finally {
      setBusy(false);
    }
  }

  async function approvePlan() {
    if (!project?.id || !workflow) return;
    setBusy(true);
    setStatus(`Applying ${lane === 'music_video' ? 'approval lock' : 'greenlight'}...`);
    try {
      const directorPlan = buildDirectorPlanPatch({ lane, workflow, existingPlan: project.director_plan });
      await updateScene(selectedScene.id, { director_plan: directorPlan });
      setProject((current) => ({ ...current, director_plan: directorPlan }));
      setStatus(`${lane === 'music_video' ? 'Approved & locked' : 'Greenlit'}.`);
    } catch (error) {
      setStatus(error.message || 'Could not apply approval.');
    } finally {
      setBusy(false);
    }
  }

  async function saveScene() {
    if (!selectedScene) return;
    setBusy(true);
    setStatus(`Saving Scene ${selectedScene.position}...`);
    try {
      const directorPlan = buildDirectorPlanPatch({
        lane,
        workflow,
        existingPlan: project?.director_plan,
      });
      await updateScene(selectedScene.id, {
        title: selectedScene.title,
        purpose: selectedScene.purpose,
        audio_sync: selectedScene.audio_sync,
        prompt: selectedScene.prompt,
        shot_direction: selectedScene.shot_direction,
        duration_seconds: Number(selectedScene.duration_seconds),
        continuity_locked: Boolean(selectedScene.continuity_locked),
        director_plan: directorPlan,
      });
      setProject((current) => ({ ...current, director_plan: directorPlan }));
      setStatus(`Scene ${selectedScene.position} saved.`);
    } catch (error) {
      setStatus(error.message || 'Could not save this scene.');
    } finally {
      setBusy(false);
    }
  }

  async function estimateGeneration() {
    if (generationBusy) return;
    const payload = generationPayload();
    if (!payload || !gate.allowed) {
      setStatus(gate.reason);
      return;
    }
    setGenerationState('estimating');
    setBusy(true);
    setStatus('Calculating generation estimate...');
    try {
      // estimate logic via existing workflow helpers
    } catch (error) {
      setStatus(error.message || 'Estimate unavailable.');
    } finally {
      setGenerationState('idle');
      setBusy(false);
    }
  }

  async function refreshProjectState(activeSceneId = '') {
    if (!project?.id) return;
    const result = await getProject(project.id);
    const mapped = mapProject(result);
    setProject(mapped);
    setWorkflow(normalizeDirectorWorkflow(mapped.lane || lane, mapped.director_plan));
    setSceneId(activeSceneId || mapped.scenes.find((scene) => scene.id === sceneId)?.id || mapped.scenes[0]?.id || '');
  }

  async function runGeneration() {
    if (generationInFlight.current || generationBusy) return;
    const payload = generationPayload();
    if (!payload || !quote) return;
    generationInFlight.current = true;
    setShowConfirm(false);
    setGenerationState('submitting');
    setBusy(true);
    setStatus('Submitting generation with reserved credits...');
    try {
      const activeSceneId = selectedScene?.id;
      const started = await startGeneration({ ...payload, confirmed_max_credits: Number(quote.credits_required || 0) });
      setProject((current) => ({
        ...current,
        scenes: current.scenes.map((scene) =>
          scene.id === activeSceneId ? { ...scene, status: 'running' } : scene
        ),
      }));
      setGenerationState('polling');
      const result = await waitForJob(started.request_id, {
        onTick: (tick) => {
          setProject((current) => ({
            ...current,
            scenes: current.scenes.map((scene) =>
              scene.id === activeSceneId ? { ...scene, status: tick.status } : scene
            ),
          }));
        },
      });
      await refreshProjectState(activeSceneId);
      setStatus(
        result.status === 'completed'
          ? 'Generation completed. Review and approve the new take in scene versions.'
          : 'Generation failed or was cancelled. Check the latest scene status before retrying.'
      );
    } catch (error) {
      setStatus(error.message || 'Generation could not be started.');
    } finally {
      generationInFlight.current = false;
      setGenerationState('idle');
      setBusy(false);
    }
  }

  const gate = generationGate({
    lane,
    workflow,
    hasScene: !!selectedScene,
  });
  const generationBusy = generationState === 'estimating' || generationState === 'submitting' || generationState === 'polling';

  if (!project) {
    return (
      <div style={{ padding: 40 }}>
        <h1>Director Workspace</h1>
        <p>Loading project...</p>
        <Link href="/">Back to dashboard</Link>
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <h1 style={{ fontSize: 20 }}>{project.title}</h1>
        {allowLaneSwitch && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setLane('music_video')}>{LANE_LABELS.music_video}</button>
            <button type="button" onClick={() => setLane('episode')}>{LANE_LABELS.episode}</button>
          </div>
        )}
        <span>{status}</span>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
        <div>
          <h2>Scene Rail</h2>
          {scenes.map((scene) => (
            <button key={scene.id} type="button" onClick={() => setSceneId(scene.id)}>
              <span style={{ display: 'block', width: '100%', aspectRatio: '16/9', borderRadius: 8, overflow: 'hidden', background: 'linear-gradient(120deg,#2d2d2d,#181818)' }}>
                <ScenePreview scene={scene} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} alt={`${scene.title || `Scene ${scene.position}`} preview`} />
              </span>
              <strong>{scene.position}. {scene.title || `Scene ${scene.position}`}</strong>
              <small>{scene.duration_seconds}s · {scene.status}</small>
              {scene.warning && <em>{scene.warning}</em>}
            </button>
          ))}
        </div>

        <section>
          <div style={{ width: '100%', aspectRatio: '16/9', borderRadius: 12, overflow: 'hidden', background: '#000' }}>
            <ScenePreview scene={selectedScene} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12 }} alt={`${selectedScene?.title || 'Selected scene'} preview`} />
          </div>
          <div>
            <p>{selectedScene?.title || 'Select a scene'}</p>
            <span>{selectedScene?.purpose || 'No scene purpose yet.'}</span>
          </div>

          <div style={{ marginTop: 16 }}>
            <h3>Inspector</h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button type="button" onClick={() => setFlightPathTab('visual')}>Visual</button>
              <button type="button" onClick={() => setFlightPathTab('audio')}>Audio</button>
            </div>
            {flightPathTab === 'visual' ? (
              <>
                <label>Title<input value={selectedScene?.title || ''} onChange={(e) => updateSceneLocal({ title: e.target.value })} /></label>
                <label>Purpose<textarea rows={3} value={selectedScene?.purpose || ''} onChange={(e) => updateSceneLocal({ purpose: e.target.value })} /></label>
                <label>Prompt<textarea rows={3} value={selectedScene?.prompt || ''} onChange={(e) => updateSceneLocal({ prompt: e.target.value })} /></label>
                <label>Camera<textarea rows={2} value={selectedScene?.shot_direction || ''} onChange={(e) => updateSceneLocal({ shot_direction: e.target.value })} /></label>
                <label>Audio Sync<textarea rows={2} value={selectedScene?.audio_sync || ''} onChange={(e) => updateSceneLocal({ audio_sync: e.target.value })} /></label>
                <div>
                  <button type="button" onClick={savePlan} disabled={busy}>Save {lane === 'music_video' ? 'music plan' : 'episode plan'}</button>
                  <button type="button" onClick={approvePlan} disabled={busy}>{lane === 'music_video' ? 'Approve & lock' : 'Greenlight episode'}</button>
                </div>
                <div>
                  <h3>Generation</h3>
                  <p>{gate.allowed ? 'Ready after estimate confirmation.' : gate.reason}</p>
                  <button type="button" onClick={estimateGeneration} disabled={busy || generationBusy || !gate.allowed}>Estimate & confirm generate</button>
                  <button type="button" onClick={runStoryboardExport} disabled={busy}>Export storyboard</button>
                </div>
              </>
            ) : (
              <p>Audio controls placeholder.</p>
            )}
          </div>
        </section>
      </section>

      {showConfirm && quote && (
        <section style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'grid', placeItems: 'center' }}>
          <section style={{ background: '#111', padding: 24, borderRadius: 12, minWidth: 320 }}>
            <h2>Confirm generation</h2>
            <p>Estimated maximum debit: {Number(quote.credits_required || 0)} credits.</p>
            <p>The server reserves credits atomically and settles actual cost on completion.</p>
            <div>
              <button type="button" onClick={runGeneration} disabled={busy || generationBusy || !quote}>Start generation</button>
              <button type="button" onClick={() => setShowConfirm(false)}>Cancel</button>
            </div>
          </section>
        </section>
      )}
    </div>
  );
}
