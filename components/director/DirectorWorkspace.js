'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import AskAiDirectorButton from '../AskAiDirectorButton';
import {
  confirmExport,
  createProject,
  getCatalog,
  getProject,
  listProjects,
  quoteExport,
  quoteGeneration,
  requestDirectorPlan,
  startGeneration,
  updateProject,
  updateScene,
  waitForJob,
} from '../../lib/cinexvideo-client';
import {
  LANE_LABELS,
  approveDirectorWorkflow,
  buildDirectorPlanPatch,
  buildSceneGenerationPayload,
  createGenerationAttempt,
  generationGate,
  generationRecoveryStorageKey,
  invalidateDirectorWorkflow,
  mapProjectForWorkspace,
  mediaTypeFor,
  normalizePickerProjects,
  preservePendingGeneration,
  safePreviewUrl,
  withStartedGeneration,
} from '../../lib/director-workflow';

const STARTER_VISUAL = Object.freeze({
  style: 'Cinematic',
  aspect_ratio: '16:9',
  lighting: '',
  camera_language: '',
  palette: [],
});

const ROUTE_COPY = Object.freeze({
  music_video: {
    hubHref: '/music-video',
    hubLabel: 'Back to Music Video Studio',
    createLabel: 'Create music-video project',
    loadingLabel: 'Loading music-video director workspace...',
  },
  episode: {
    hubHref: '/create',
    hubLabel: 'Back to Creation Hub',
    createLabel: 'Create episode project',
    loadingLabel: 'Loading episode director workspace...',
  },
});

function sceneStatusTone(status) {
  switch (status) {
    case 'approved':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30';
    case 'needs_review':
    case 'completed':
      return 'bg-sky-500/15 text-sky-200 border-sky-400/30';
    case 'generating':
    case 'running':
    case 'queued':
      return 'bg-amber-500/15 text-amber-200 border-amber-400/30';
    case 'failed':
      return 'bg-rose-500/15 text-rose-200 border-rose-400/30';
    default:
      return 'bg-white/5 text-slate-300 border-white/10';
  }
}

function formatUpdatedAt(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function projectHref(pathname, projectId) {
  return `${pathname}?project=${encodeURIComponent(projectId)}`;
}

function ScenePreview({ media, className, alt }) {
  const thumbnail = media?.preview_thumbnail_url || safePreviewUrl(media?.preview_url || '');
  const output = media?.preview_output_url || safePreviewUrl(media?.preview_url || '');
  const mediaType = media?.preview_media_type || mediaTypeFor(output);
  const src = thumbnail || output;
  if (!src) return null;
  if (thumbnail || mediaType === 'image') {
    return <img className={className} src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" />;
  }
  return <video className={className} src={src} muted playsInline preload="metadata" aria-label={alt} controls={false} />;
}

function EmptyMonitor({ scene }) {
  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[radial-gradient(circle_at_50%_0%,rgba(249,115,22,.18),transparent_45%),linear-gradient(135deg,#111827,#030712)]">
      <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
      <div className="relative max-w-xl px-6 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-orange-300">16:9 Director Monitor</p>
        <h2 className="mt-3 text-2xl font-black tracking-tight text-white">{scene?.title || 'Select a scene'}</h2>
        <p className="mx-auto mt-4 max-w-lg text-sm leading-7 text-slate-300">
          {scene?.prompt || scene?.purpose || 'The newest completed take will appear here for review. Until then, refine direction, approve the lane, and estimate generation safely.'}
        </p>
      </div>
    </div>
  );
}

export default function DirectorWorkspace({ initialLane = 'episode', allowLaneSwitch = true }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const currentProjectId = search.get('project') || '';
  const [lane, setLane] = useState(initialLane === 'music_video' ? 'music_video' : 'episode');
  const [workspaceState, setWorkspaceState] = useState(currentProjectId ? 'loading' : 'picker');
  const [project, setProject] = useState(null);
  const [projectOptions, setProjectOptions] = useState([]);
  const [catalogOption, setCatalogOption] = useState(null);
  const [sceneId, setSceneId] = useState('');
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [message, setMessage] = useState(currentProjectId ? ROUTE_COPY[lane].loadingLabel : 'Select a project or create one to open the Director workspace.');
  const [busyAction, setBusyAction] = useState('');
  const [quote, setQuote] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [exportQuote, setExportQuote] = useState(null);
  const [showExportConfirm, setShowExportConfirm] = useState(false);
  const [generationState, setGenerationState] = useState('idle');
  const [pendingGeneration, setPendingGeneration] = useState(null);
  const [creationDraft, setCreationDraft] = useState({
    title: '',
    brief: '',
    style: 'Cinematic',
    aspectRatio: '16:9',
  });

  const selectedScene = useMemo(
    () => project?.scenes?.find((scene) => scene.id === sceneId) || null,
    [project, sceneId]
  );
  const activeVersion =
    selectedScene?.versions?.find((version) => Number(version.version) === Number(selectedVersion)) ||
    selectedScene?.versions?.[0] ||
    null;
  const gate = generationGate({
    lane: project?.lane || lane,
    workflow: project?.workflow,
    hasScene: Boolean(selectedScene),
  });
  const generationBusy = ['estimating', 'submitting', 'polling', 'exporting'].includes(generationState);

  useEffect(() => {
    if (!selectedScene) {
      setSelectedVersion(null);
      return;
    }
    setSelectedVersion((current) => {
      if (selectedScene.versions.some((version) => Number(version.version) === Number(current))) return current;
      return selectedScene.versions[0]?.version ?? selectedScene.active_version ?? null;
    });
  }, [selectedScene]);

  useEffect(() => {
    if (!project?.id || typeof window === 'undefined') return;
    const key = generationRecoveryStorageKey(project.id);
    if (pendingGeneration?.requestId || pendingGeneration?.idempotencyKey) {
      window.sessionStorage.setItem(key, JSON.stringify(pendingGeneration));
    } else {
      window.sessionStorage.removeItem(key);
    }
  }, [project?.id, pendingGeneration]);

  useEffect(() => {
    let cancelled = false;

    async function loadPicker() {
      setWorkspaceState('loading');
      try {
        const [{ projects }, catalog] = await Promise.all([listProjects(), getCatalog()]);
        if (cancelled) return;
        setProject(null);
        setProjectOptions(normalizePickerProjects(projects, lane));
        setCatalogOption((catalog.options || []).find((option) => option.operation === 'video') || null);
        setSceneId('');
        setSelectedVersion(null);
        setPendingGeneration(null);
        setWorkspaceState('picker');
        setMessage('Select an existing project or create a new one to open the full Director workspace.');
      } catch (error) {
        if (cancelled) return;
        if (/sign in/i.test(error.message || '')) {
          setWorkspaceState('auth');
          setMessage('Please sign in to access the Director workspace.');
          return;
        }
        setWorkspaceState('error');
        setMessage(error.message || 'The Director workspace could not be loaded.');
      }
    }

    async function loadProjectById(projectId, loadingMessage = ROUTE_COPY[lane].loadingLabel) {
      setWorkspaceState('loading');
      setMessage(loadingMessage);
      try {
        const [result, catalog] = await Promise.all([getProject(projectId), getCatalog()]);
        if (cancelled) return null;
        const mapped = mapProjectForWorkspace(result, { fallbackLane: lane });
        setLane(mapped.lane);
        setProject(mapped);
        setProjectOptions([]);
        setCatalogOption((catalog.options || []).find((option) => option.operation === 'video') || null);
        setSceneId((current) =>
          mapped.scenes.some((scene) => scene.id === current) ? current : mapped.scenes[0]?.id || ''
        );
        setWorkspaceState('ready');
        if (typeof window !== 'undefined') {
          const stored = window.sessionStorage.getItem(generationRecoveryStorageKey(mapped.id));
          if (stored) {
            try {
              const parsed = JSON.parse(stored);
              if (parsed?.sceneId && mapped.scenes.some((scene) => scene.id === parsed.sceneId)) {
                setPendingGeneration(parsed);
              } else {
                setPendingGeneration(null);
              }
            } catch {
              setPendingGeneration(null);
            }
          } else {
            setPendingGeneration(null);
          }
        }
        return mapped;
      } catch (error) {
        if (cancelled) return null;
        if (/sign in/i.test(error.message || '')) {
          setWorkspaceState('auth');
          setMessage('Please sign in to access the Director workspace.');
          return null;
        }
        setWorkspaceState('error');
        setMessage(error.message || 'The Director workspace could not be loaded.');
        return null;
      }
    }

    if (currentProjectId) {
      loadProjectById(currentProjectId);
    } else {
      loadPicker();
    }

    return () => {
      cancelled = true;
    };
  }, [currentProjectId, lane]);

  function mergeProject(nextProject) {
    setProject((current) => ({
      ...(current || {}),
      ...nextProject,
      visual_identity: {
        ...(current?.visual_identity || STARTER_VISUAL),
        ...(nextProject.visual_identity || {}),
      },
    }));
  }

  function invalidateLocalGate() {
    setProject((current) => {
      if (!current) return current;
      const { workflow } = invalidateDirectorWorkflow({
        lane: current.lane,
        workflow: current.workflow,
      });
      return { ...current, workflow };
    });
    setQuote(null);
    setShowConfirm(false);
  }

  function updateProjectLocal(patch) {
    mergeProject(patch);
    invalidateLocalGate();
    setMessage('');
  }

  function updateSceneLocal(patch) {
    setProject((current) => {
      if (!current) return current;
      return {
        ...current,
        scenes: current.scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene)),
      };
    });
    invalidateLocalGate();
    setMessage('');
  }

  async function reloadProject(activeSceneId = sceneId, loadingMessage = '') {
    const result = await getProject(project.id);
    const mapped = mapProjectForWorkspace(result, { fallbackLane: project.lane });
    setProject(mapped);
    setSceneId(
      mapped.scenes.some((scene) => scene.id === activeSceneId) ? activeSceneId : mapped.scenes[0]?.id || ''
    );
    if (loadingMessage) setMessage(loadingMessage);
    return mapped;
  }

  async function persistPlan(nextWorkflow, successMessage) {
    if (!project?.id) return;
    setBusyAction('plan');
    setMessage('Saving project direction...');
    try {
      const directorPlan = buildDirectorPlanPatch({
        lane: project.lane,
        workflow: nextWorkflow,
        existingPlan: project.director_plan,
        projectMeta: {
          title: project.title,
          logline: project.logline,
          visual_identity: project.visual_identity,
        },
      });
      await updateProject(project.id, {
        title: project.title,
        logline: project.logline,
        visual_identity: project.visual_identity,
        director_plan: directorPlan,
      });
      mergeProject({ director_plan: directorPlan, workflow: nextWorkflow });
      setQuote(null);
      setShowConfirm(false);
      setMessage(successMessage);
    } catch (error) {
      setMessage(error.message || 'The project plan could not be saved.');
    } finally {
      setBusyAction('');
    }
  }

  async function saveScene() {
    if (!selectedScene) return;
    setBusyAction(selectedScene.id);
    setMessage(`Saving Scene ${selectedScene.position}...`);
    try {
      await updateScene(selectedScene.id, {
        title: selectedScene.title,
        purpose: selectedScene.purpose,
        prompt: selectedScene.prompt,
        shot_direction: selectedScene.shot_direction,
        ...(selectedScene.audio_sync_supported || selectedScene.audio_sync
          ? { audio_sync: selectedScene.audio_sync }
          : {}),
        continuity_locked: Boolean(selectedScene.continuity_locked),
        duration_seconds: Number(selectedScene.duration_seconds || 8),
      });
      await reloadProject(selectedScene.id);
      setMessage(`Scene ${selectedScene.position} saved. Generation approval was rechecked server-side.`);
    } catch (error) {
      setMessage(error.message || 'The scene could not be saved.');
    } finally {
      setBusyAction('');
    }
  }

  async function approveLane() {
    const nextWorkflow = approveDirectorWorkflow({
      lane: project?.lane || lane,
      workflow: project?.workflow,
    });
    await persistPlan(
      nextWorkflow,
      project?.lane === 'music_video' ? 'Music-video plan approved and locked.' : 'Episode plan greenlit.'
    );
  }

  async function estimateGeneration() {
    if (!selectedScene || !project || !catalogOption || generationBusy || pendingGeneration) return;
    const payload = buildSceneGenerationPayload({ project, scene: selectedScene, option: catalogOption });
    if (!payload || !gate.allowed) {
      setMessage(gate.reason);
      return;
    }
    setGenerationState('estimating');
    setBusyAction('estimate');
    setMessage('Calculating the server-side generation estimate...');
    try {
      const nextQuote = await quoteGeneration(payload);
      setQuote(nextQuote);
      setShowConfirm(true);
      setMessage('');
    } catch (error) {
      setMessage(error.message || 'A generation estimate is not available right now.');
    } finally {
      setGenerationState('idle');
      setBusyAction('');
    }
  }

  async function pollGeneration(attempt, activeSceneId) {
    let keepPending = null;
    setGenerationState('polling');
    setBusyAction('generation');
    try {
      const result = await waitForJob(attempt.requestId, {
        onTick: (tick) => {
          setProject((current) => {
            if (!current) return current;
            return {
              ...current,
              scenes: current.scenes.map((scene) =>
                scene.id === activeSceneId ? { ...scene, status: tick.status || scene.status } : scene
              ),
            };
          });
        },
      });
      setPendingGeneration(null);
      await reloadProject(activeSceneId);
      setMessage(
        result.status === 'completed'
          ? 'Generation completed. The newest take is ready for review and approval.'
          : 'Generation failed. Credits for failed work were returned on the server.'
      );
    } catch (error) {
      keepPending = preservePendingGeneration(attempt, error);
      setPendingGeneration(keepPending);
      setMessage(
        keepPending
          ? 'Generation is still being tracked. Resume polling to continue without starting a second paid job.'
          : error.message || 'Generation could not be completed.'
      );
    } finally {
      setGenerationState(keepPending ? 'recoverable' : 'idle');
      setBusyAction('');
    }
  }

  async function runGeneration() {
    if (!selectedScene || !project || generationBusy) return;
    const prepared = createGenerationAttempt({
      pendingGeneration,
      sceneId: selectedScene.id,
    });
    if (prepared.mode === 'resume' && prepared.attempt.requestId) {
      setShowConfirm(false);
      await pollGeneration(prepared.attempt, selectedScene.id);
      return;
    }
    if (!quote || !catalogOption) return;
    setShowConfirm(false);
    setGenerationState('submitting');
    setBusyAction('generation');
    setMessage('Rechecking approvals and starting generation...');
    try {
      const refreshed = await reloadProject(selectedScene.id);
      const refreshedScene = refreshed.scenes.find((scene) => scene.id === selectedScene.id);
      const refreshedGate = generationGate({
        lane: refreshed.lane,
        workflow: refreshed.workflow,
        hasScene: Boolean(refreshedScene),
      });
      if (!refreshedGate.allowed || !refreshedScene) {
        setQuote(null);
        setMessage(refreshedGate.reason);
        setGenerationState('idle');
        setBusyAction('');
        return;
      }
      const payload = buildSceneGenerationPayload({
        project: refreshed,
        scene: refreshedScene,
        option: catalogOption,
      });
      const started = await startGeneration({
        ...payload,
        confirmed_max_credits: Number(quote.credits_required || 0),
        idempotency_key: prepared.attempt.idempotencyKey,
      });
      const activeAttempt = withStartedGeneration(prepared.attempt, started);
      setPendingGeneration(activeAttempt);
      setProject((current) => {
        if (!current) return current;
        return {
          ...current,
          scenes: current.scenes.map((scene) =>
            scene.id === refreshedScene.id ? { ...scene, status: started.status || 'running' } : scene
          ),
        };
      });
      await pollGeneration(activeAttempt, refreshedScene.id);
    } catch (error) {
      setPendingGeneration(null);
      setGenerationState('idle');
      setBusyAction('');
      setMessage(error.message || 'Generation could not be started.');
    }
  }

  async function approveTake(versionNumber) {
    if (!selectedScene || !Number.isFinite(Number(versionNumber))) return;
    setBusyAction(`approve-${versionNumber}`);
    setMessage(`Approving take v${versionNumber}...`);
    try {
      await updateScene(selectedScene.id, { approve_version: Number(versionNumber) });
      await reloadProject(selectedScene.id);
      setSelectedVersion(Number(versionNumber));
      setMessage(`Take v${versionNumber} is now approved.`);
    } catch (error) {
      setMessage(error.message || 'The selected take could not be approved.');
    } finally {
      setBusyAction('');
    }
  }

  async function prepareStoryboardExport() {
    if (!project?.id || generationBusy) return;
    setGenerationState('exporting');
    setBusyAction('export');
    setMessage('Pricing storyboard export...');
    try {
      const nextQuote = await quoteExport({ project_id: project.id, export_type: 'storyboard' });
      setExportQuote(nextQuote);
      setShowExportConfirm(true);
      setMessage('');
    } catch (error) {
      setMessage(error.message || 'Storyboard export is not available right now.');
    } finally {
      setGenerationState('idle');
      setBusyAction('');
    }
  }

  async function confirmStoryboardExport() {
    if (!project?.id) return;
    setGenerationState('exporting');
    setBusyAction('export');
    setMessage('Building storyboard export...');
    try {
      const result = await confirmExport({ project_id: project.id, export_type: 'storyboard' });
      setShowExportConfirm(false);
      setExportQuote(null);
      setMessage(
        `Storyboard export ready${Number(result.credits_charged || 0) > 0 ? ` — ${result.credits_charged} credits charged.` : '.'}`
      );
      if (result.download_url) {
        window.open(result.download_url, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      setMessage(error.message || 'Storyboard export could not be completed.');
    } finally {
      setGenerationState('idle');
      setBusyAction('');
    }
  }

  async function createWorkspaceProject(event) {
    event.preventDefault();
    if (!creationDraft.title.trim()) {
      setMessage('Add a project title to create a Director workspace.');
      return;
    }
    setBusyAction('create');
    setMessage('Creating project workspace...');
    try {
      let plan;
      if (creationDraft.brief.trim()) {
        const drafted = await requestDirectorPlan(creationDraft.brief, lane);
        plan = {
          ...drafted,
          creative_title: creationDraft.title.trim(),
          logline: drafted.logline || creationDraft.brief.trim(),
          visual_identity: {
            ...STARTER_VISUAL,
            ...(drafted.visual_identity || {}),
            style: creationDraft.style,
            aspect_ratio: creationDraft.aspectRatio,
          },
        };
      } else {
        plan = {
          creative_title: creationDraft.title.trim(),
          logline: '',
          visual_identity: {
            ...STARTER_VISUAL,
            style: creationDraft.style,
            aspect_ratio: creationDraft.aspectRatio,
          },
          characters: [],
          locations: [],
          outfits: [],
          scenes: [
            {
              title: lane === 'music_video' ? 'Performance setup' : 'Scene 1',
              purpose: lane === 'music_video' ? 'Establish the hook and on-beat visual identity.' : 'Establish the opening dramatic beat.',
              duration_seconds: 8,
              shot_direction: '',
              prompt: '',
              audio_sync: '',
            },
          ],
        };
      }
      const created = await createProject({
        lane,
        title: creationDraft.title.trim(),
        plan,
      });
      window.location.assign(projectHref(pathname, created.project_id));
    } catch (error) {
      setMessage(error.message || 'The project could not be created.');
      setBusyAction('');
    }
  }

  if (workspaceState === 'auth') {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 md:px-6">
        <div className="mx-auto max-w-3xl rounded-3xl border border-white/10 bg-slate-900/75 p-8 shadow-2xl shadow-black/20">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-300">Director Workspace</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-white">Authentication required</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">{message}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/auth" className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold text-slate-950">Sign in</Link>
            <Link href={ROUTE_COPY[lane].hubHref} className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-slate-200">Return</Link>
          </div>
        </div>
      </main>
    );
  }

  if (workspaceState === 'error') {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 md:px-6">
        <div className="mx-auto max-w-3xl rounded-3xl border border-rose-400/25 bg-slate-900/75 p-8 shadow-2xl shadow-black/20">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-rose-300">Director Workspace</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-white">Workspace unavailable</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">{message}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={ROUTE_COPY[lane].hubHref} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold text-slate-950">Return</Link>
            <button type="button" className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-slate-200" onClick={() => window.location.reload()}>Retry</button>
          </div>
        </div>
      </main>
    );
  }

  if (workspaceState === 'loading') {
    return <main className="min-h-screen bg-slate-950 px-4 py-12 text-center text-sm text-slate-300">{message}</main>;
  }

  if (workspaceState === 'picker') {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 md:px-6">
        <div className="mx-auto grid max-w-7xl gap-4 xl:grid-cols-[minmax(0,1.2fr)_380px]">
          <section className="rounded-3xl border border-white/10 bg-slate-900/75 p-6 shadow-2xl shadow-black/20">
            <div className="flex flex-wrap items-center gap-3 border-b border-white/10 pb-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-300">Director Workspace</p>
                <h1 className="mt-2 text-4xl font-black tracking-tight text-white">{allowLaneSwitch ? 'Choose a lane and open a project' : LANE_LABELS[lane]}</h1>
              </div>
              {allowLaneSwitch && (
                <div className="ml-auto flex rounded-xl border border-white/10 bg-slate-950/70 p-1">
                  {Object.entries(LANE_LABELS).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setLane(value)}
                      className={`rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] ${lane === value ? 'bg-orange-500 text-slate-950' : 'text-slate-300'}`}
                    >
                      {label.replace(' Director', '')}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="mt-5 max-w-3xl text-sm leading-7 text-slate-300">
              Reach the full director workspace from here: pick an existing project, or create a new cinematic workspace with a title and optional brief. You can continue to the same route without bouncing through a separate placeholder screen.
            </p>
            <div className="mt-8 space-y-3">
              {projectOptions.length ? (
                projectOptions.map((item) => (
                  <Link
                    key={item.id}
                    href={projectHref(pathname, item.id)}
                    className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/55 p-4 text-left transition hover:border-orange-300/45 hover:bg-white/[.03]"
                  >
                    <span className="min-w-0">
                      <strong className="block truncate text-sm text-white">{item.title}</strong>
                      <span className="mt-1 block truncate text-xs text-slate-400">{item.logline || 'No logline yet.'}</span>
                    </span>
                    <span className="ml-4 text-right text-xs text-slate-500">{item.status} · {formatUpdatedAt(item.updated_at)}</span>
                  </Link>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/40 p-6 text-sm text-slate-400">
                  No {lane === 'music_video' ? 'music-video' : 'episode'} projects yet. Create one below to open the workspace.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-slate-900/75 p-6 shadow-2xl shadow-black/20">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-300">Create project</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-white">{ROUTE_COPY[lane].createLabel}</h2>
            <form className="mt-6 grid gap-4" onSubmit={createWorkspaceProject}>
              <label className="grid gap-1.5 text-xs font-semibold text-slate-400">
                <span>Project title</span>
                <input className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-400/70" value={creationDraft.title} onChange={(event) => setCreationDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Midnight Signal" />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-slate-400">
                <span>Creative brief <span className="font-normal text-slate-500">(optional)</span></span>
                <textarea className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-400/70" rows={5} value={creationDraft.brief} onChange={(event) => setCreationDraft((current) => ({ ...current, brief: event.target.value }))} placeholder="Describe the world, rhythm, or episode beat you want the Director to plan." />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-semibold text-slate-400">
                  <span>Style</span>
                  <input className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-400/70" value={creationDraft.style} onChange={(event) => setCreationDraft((current) => ({ ...current, style: event.target.value }))} />
                </label>
                <label className="grid gap-1.5 text-xs font-semibold text-slate-400">
                  <span>Aspect ratio</span>
                  <input className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-400/70" value={creationDraft.aspectRatio} onChange={(event) => setCreationDraft((current) => ({ ...current, aspectRatio: event.target.value }))} />
                </label>
              </div>
              <button type="submit" className="rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-slate-950" disabled={busyAction === 'create'}>
                {busyAction === 'create' ? 'Creating workspace...' : ROUTE_COPY[lane].createLabel}
              </button>
              <p className="text-xs leading-6 text-slate-400">If you provide a brief, the server-side Director will create an initial plan and scenes. Without a brief, you&apos;ll get a starter project with one editable scene.</p>
              {message && <p className="text-sm text-slate-300">{message}</p>}
            </form>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/90 px-4 backdrop-blur md:px-6">
        <div className="mx-auto flex min-h-16 max-w-[1600px] flex-wrap items-center gap-3 py-3">
          <Link href={ROUTE_COPY[project.lane].hubHref} className="flex items-center gap-2 text-sm font-semibold tracking-tight text-white" aria-label="Back"><span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-orange-400 to-orange-700 text-sm font-black text-slate-950">C</span><span className="hidden sm:inline">Cinex Video</span></Link>
          <div className="min-w-0 border-l border-white/10 pl-3 text-sm text-slate-400">
            <span className="hidden sm:inline">{LANE_LABELS[project.lane]} / </span>
            <strong className="font-semibold text-slate-100">{project.title}</strong>
          </div>
          <span className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] ${sceneStatusTone(project.workflow?.approval_locked || project.workflow?.greenlit ? 'approved' : 'draft')}`}>
            {project.lane === 'music_video'
              ? project.workflow?.approval_locked ? 'Approved & locked' : 'Needs approval'
              : project.workflow?.greenlit ? 'Greenlit' : 'Needs greenlight'}
          </span>
          {pendingGeneration?.requestId && (
            <span className="rounded-full border border-amber-400/30 bg-amber-500/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-amber-200">
              Active request tracked
            </span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => persistPlan(project.workflow, 'Project context saved.')} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-orange-400/70 hover:bg-white/5" disabled={Boolean(busyAction)}>
              {busyAction === 'plan' ? 'Saving...' : 'Save plan'}
            </button>
            <button type="button" onClick={approveLane} className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300" disabled={Boolean(busyAction) || !project.scenes.length}>
              {project.lane === 'music_video' ? 'Approve & lock' : 'Greenlight'}
            </button>
            <button type="button" onClick={pendingGeneration?.requestId ? () => pollGeneration(pendingGeneration, pendingGeneration.sceneId) : estimateGeneration} className="rounded-lg border border-orange-400/40 px-3 py-2 text-xs font-bold text-orange-300 transition hover:bg-orange-400/10 disabled:cursor-not-allowed disabled:opacity-60" disabled={generationBusy || (!pendingGeneration?.requestId && (!gate.allowed || !catalogOption || !selectedScene))}>
              {pendingGeneration?.requestId ? 'Resume polling' : quote ? 'Refresh estimate' : 'Estimate generation'}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-3 p-3 xl:grid-cols-[290px_minmax(0,1fr)_360px] xl:grid-rows-[minmax(0,1fr)_235px] xl:p-4">
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-2xl shadow-black/20 xl:row-span-2">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Scene rail</p>
              <p className="mt-0.5 text-xs text-slate-500">{project.scenes.length} scenes · newest takes shown first</p>
            </div>
            <Link href={projectHref(pathname, project.id)} className="rounded-md border border-orange-400/40 px-2 py-1 text-xs font-bold text-orange-300 hover:bg-orange-400/10">Refresh</Link>
          </div>
          <div className="max-h-[320px] space-y-2 overflow-y-auto p-3 xl:max-h-[calc(100vh-150px)]">
            {project.scenes.length ? project.scenes.map((scene) => (
              <button
                key={scene.id}
                type="button"
                onClick={() => setSceneId(scene.id)}
                className={`w-full rounded-xl border p-3 text-left transition ${scene.id === sceneId ? 'border-orange-400 bg-orange-400/10 shadow-[0_0_0_1px_rgba(251,146,60,.18)]' : 'border-white/10 bg-slate-950/45 hover:border-orange-300/45 hover:bg-white/[.03]'}`}
              >
                <div className="flex items-start gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-orange-400/35 bg-orange-400/10 font-mono text-xs font-bold text-orange-300">{scene.position}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold text-slate-100">{scene.title || `Scene ${scene.position}`}</span>
                    <span className="mt-1 block truncate text-xs text-slate-400">{scene.purpose || 'No story purpose added.'}</span>
                    <span className="mt-2 block overflow-hidden rounded-lg border border-white/10 bg-black/30" style={{ aspectRatio: '16 / 9' }}>
                      {scene.preview_url ? (
                        <ScenePreview media={scene} className="h-full w-full object-cover" alt={`${scene.title || `Scene ${scene.position}`} preview`} />
                      ) : (
                        <span className="grid h-full w-full place-items-center text-[11px] uppercase tracking-[0.2em] text-slate-500">No take yet</span>
                      )}
                    </span>
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${sceneStatusTone(scene.status)}`}>{scene.status}</span>
                  <span className="font-mono text-xs text-slate-500">{scene.duration_seconds}s</span>
                </div>
              </button>
            )) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/40 p-6 text-sm text-slate-400">This project has no scenes yet.</div>
            )}
          </div>
        </section>

        <section className="flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-2xl shadow-black/20">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Preview monitor</p>
              <p className="mt-0.5 text-xs text-slate-500">{selectedScene ? `Scene ${selectedScene.position}` : 'Select a scene'} · 16:9 review</p>
            </div>
            <span className="font-mono text-xs text-slate-500">v{activeVersion?.version || selectedScene?.active_version || 0}</span>
          </div>
          <div className="m-4 flex-1 overflow-hidden rounded-xl border border-white/10 bg-black">
            {activeVersion?.preview_url || selectedScene?.preview_url ? (
              <div className="relative h-full">
                <ScenePreview media={activeVersion?.preview_url ? activeVersion : selectedScene} className="h-full w-full object-cover" alt={`${selectedScene?.title || 'Selected scene'} preview`} />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-300">Review target</p>
                  <h2 className="mt-1 text-2xl font-black tracking-tight text-white">{selectedScene?.title || 'Selected scene'}</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200">{selectedScene?.prompt || selectedScene?.purpose || 'No direction saved yet.'}</p>
                </div>
              </div>
            ) : (
              <EmptyMonitor scene={selectedScene} />
            )}
          </div>
          <div className="grid gap-4 border-t border-white/10 px-4 py-4 sm:grid-cols-3">
            <article className="rounded-xl border border-white/10 bg-slate-950/55 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Prompt</p>
              <p className="mt-2 text-sm leading-6 text-slate-200">{selectedScene?.prompt || 'No visual prompt added.'}</p>
            </article>
            <article className="rounded-xl border border-white/10 bg-slate-950/55 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Camera</p>
              <p className="mt-2 text-sm leading-6 text-slate-200">{selectedScene?.shot_direction || 'No camera direction added.'}</p>
            </article>
            <article className="rounded-xl border border-white/10 bg-slate-950/55 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Audio Sync</p>
              <p className="mt-2 text-sm leading-6 text-slate-200">{selectedScene?.audio_sync || 'No audio-sync notes saved yet.'}</p>
            </article>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-2xl shadow-black/20">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Inspector</p>
              <p className="mt-0.5 text-xs text-slate-500">Project context, scene direction, approval, and take review</p>
            </div>
          </div>
          <div className="grid max-h-[calc(100vh-180px)] gap-5 overflow-y-auto p-4">
            <section className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-300">Project context</p>
              <div className="mt-4 grid gap-4">
                <label className="grid gap-1.5 text-xs font-semibold text-slate-400">
                  <span>Project title</span>
                  <input className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-400/70" value={project.title} onChange={(event) => updateProjectLocal({ title: event.target.value })} />
                </label>
                <label className="grid gap-1.5 text-xs font-semibold text-slate-400">
                  <span>Logline / overview</span>
                  <textarea className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-400/70" rows={4} value={project.logline} onChange={(event) => updateProjectLocal({ logline: event.target.value })} />
                  <AskAiDirectorButton
                    fieldType="story"
                    label="project logline"
                    value={project.logline}
                    context={{ projectTitle: project.title, style: project.visual_identity.style, duration: project.scenes.reduce((total, scene) => total + Number(scene.duration_seconds || 0), 0) }}
                    onApply={(suggestion) => updateProjectLocal({ logline: suggestion })}
                  />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-xs font-semibold text-slate-400">
                    <span>Visual style</span>
                    <input className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-400/70" value={project.visual_identity.style} onChange={(event) => updateProjectLocal({ visual_identity: { style: event.target.value } })} />
                  </label>
                  <label className="grid gap-1.5 text-xs font-semibold text-slate-400">
                    <span>Aspect ratio</span>
                    <input className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-400/70" value={project.visual_identity.aspect_ratio} onChange={(event) => updateProjectLocal({ visual_identity: { aspect_ratio: event.target.value } })} />
                  </label>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-xs font-semibold text-slate-400">
                    <span>Lighting</span>
                    <textarea className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-400/70" rows={3} value={project.visual_identity.lighting} onChange={(event) => updateProjectLocal({ visual_identity: { lighting: event.target.value } })} />
                  </label>
                  <label className="grid gap-1.5 text-xs font-semibold text-slate-400">
                    <span>Camera language</span>
                    <textarea className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-400/70" rows={3} value={project.visual_identity.camera_language} onChange={(event) => updateProjectLocal({ visual_identity: { camera_language: event.target.value } })} />
                  </label>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-300">Scene editor</p>
                  <p className="mt-1 text-xs text-slate-500">Every generation-relevant change invalidates approval or greenlight until you explicitly re-approve.</p>
                </div>
                {selectedScene && (
                  <button type="button" className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-slate-100 hover:border-orange-400/70 hover:bg-white/5" onClick={saveScene} disabled={Boolean(busyAction)}>
                    {busyAction === selectedScene.id ? 'Saving...' : 'Save scene'}
                  </button>
                )}
              </div>
              {selectedScene ? (
                <div className="mt-4 grid gap-4">
                  <label className="grid gap-1.5 text-xs font-semibold text-slate-400">
                    <span>Scene title</span>
                    <input className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-400/70" value={selectedScene.title} onChange={(event) => updateSceneLocal({ title: event.target.value })} />
                  </label>
                  <label className="grid gap-1.5 text-xs font-semibold text-slate-400">
                    <span>Purpose</span>
                    <textarea className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-400/70" rows={3} value={selectedScene.purpose} onChange={(event) => updateSceneLocal({ purpose: event.target.value })} />
                  </label>
                  <label className="grid gap-1.5 text-xs font-semibold text-slate-400">
                    <span>Visual prompt</span>
                    <textarea className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-400/70" rows={4} value={selectedScene.prompt} onChange={(event) => updateSceneLocal({ prompt: event.target.value })} />
                    <AskAiDirectorButton
                      fieldType="scene"
                      label={`scene ${selectedScene.position} visual prompt`}
                      value={selectedScene.prompt}
                      context={{
                        projectTitle: project.title,
                        logline: project.logline,
                        style: project.visual_identity.style,
                        duration: selectedScene.duration_seconds,
                        sceneContext: [selectedScene.title, selectedScene.purpose, selectedScene.shot_direction].filter(Boolean).join('\n'),
                      }}
                      onApply={(suggestion) => updateSceneLocal({ prompt: suggestion })}
                    />
                  </label>
                  <label className="grid gap-1.5 text-xs font-semibold text-slate-400">
                    <span>Camera direction</span>
                    <textarea className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-400/70" rows={3} value={selectedScene.shot_direction} onChange={(event) => updateSceneLocal({ shot_direction: event.target.value })} />
                    <AskAiDirectorButton
                      fieldType="visualNotes"
                      label={`scene ${selectedScene.position} camera direction`}
                      value={selectedScene.shot_direction}
                      context={{
                        projectTitle: project.title,
                        logline: project.logline,
                        style: project.visual_identity.style,
                        duration: selectedScene.duration_seconds,
                        sceneContext: [selectedScene.title, selectedScene.purpose, selectedScene.prompt].filter(Boolean).join('\n'),
                      }}
                      onApply={(suggestion) => updateSceneLocal({ shot_direction: suggestion })}
                    />
                  </label>
                  <label className="grid gap-1.5 text-xs font-semibold text-slate-400">
                    <span>Audio Sync</span>
                    <textarea className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-400/70" rows={3} value={selectedScene.audio_sync} onChange={(event) => updateSceneLocal({ audio_sync: event.target.value })} placeholder="Timing, lyric accents, beats, breaths, or sync cues..." />
                    {!selectedScene.audio_sync_supported && (
                      <span className="text-[11px] font-normal leading-5 text-amber-200">This deployment still needs the latest scene schema migration before Audio Sync can be saved safely.</span>
                    )}
                  </label>
                  <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
                    <label className="grid gap-1.5 text-xs font-semibold text-slate-400">
                      <span>Duration (sec)</span>
                      <input type="number" min="1" max="600" className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-400/70" value={selectedScene.duration_seconds} onChange={(event) => updateSceneLocal({ duration_seconds: event.target.value })} />
                    </label>
                    <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/55 px-4 py-3 text-xs font-semibold text-slate-300">
                      <input type="checkbox" checked={selectedScene.continuity_locked} onChange={(event) => updateSceneLocal({ continuity_locked: event.target.checked })} />
                      Continuity locked for this scene
                    </label>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-400">Select a scene from the rail to edit visual direction, prompts, continuity, and audio sync.</p>
              )}
            </section>

            <section className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-300">Generation controls</p>
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                <p>{gate.allowed ? 'The lane is approved for estimate and paid confirmation.' : gate.reason}</p>
                {quote && <p className="rounded-xl border border-white/10 bg-slate-950/55 px-3 py-3 text-sm text-slate-200">Current maximum debit: <strong>{Number(quote.credits_required || 0)} credits</strong>. The server reserves credits atomically and settles actual cost after completion.</p>}
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={estimateGeneration} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300" disabled={!selectedScene || !catalogOption || Boolean(pendingGeneration) || generationBusy || !gate.allowed}>
                    {generationState === 'estimating' ? 'Estimating...' : 'Estimate & confirm'}
                  </button>
                  <button type="button" onClick={prepareStoryboardExport} className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-60" disabled={generationBusy || !project.id}>
                    {busyAction === 'export' ? 'Pricing export...' : 'Export storyboard'}
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-300">Scene versions</p>
                  <p className="mt-1 text-xs text-slate-500">Completed takes are listed newest first. Approve the selected or newest completed take explicitly.</p>
                </div>
                {activeVersion?.status === 'completed' && (
                  <button type="button" className="rounded-lg border border-orange-400/40 px-3 py-2 text-xs font-bold text-orange-300 hover:bg-orange-400/10" onClick={() => approveTake(activeVersion.version)} disabled={Boolean(busyAction) || activeVersion.approved}>
                    {busyAction === `approve-${activeVersion.version}` ? 'Approving...' : activeVersion.approved ? 'Approved' : `Approve v${activeVersion.version}`}
                  </button>
                )}
              </div>
              <div className="mt-4 space-y-3">
                {selectedScene?.versions?.length ? selectedScene.versions.map((version) => (
                  <button
                    key={version.version}
                    type="button"
                    onClick={() => setSelectedVersion(version.version)}
                    className={`w-full rounded-2xl border p-3 text-left transition ${Number(selectedVersion) === Number(version.version) ? 'border-orange-400 bg-orange-400/10 shadow-[0_0_0_1px_rgba(251,146,60,.18)]' : 'border-white/10 bg-slate-950/55 hover:border-orange-300/45 hover:bg-white/[.03]'}`}
                  >
                    <div className="flex gap-3">
                      <div className="h-20 w-32 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/40">
                        {version.preview_url ? (
                          <ScenePreview media={version} className="h-full w-full object-cover" alt={`Take version ${version.version} preview`} />
                        ) : (
                          <span className="grid h-full w-full place-items-center text-[11px] uppercase tracking-[0.18em] text-slate-500">No preview</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-sm text-white">Take v{version.version}</strong>
                          <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${sceneStatusTone(version.approved ? 'approved' : version.status)}`}>{version.approved ? 'approved' : version.status}</span>
                        </div>
                        <p className="mt-2 text-xs text-slate-400">
                          {version.created_at ? `Created ${formatUpdatedAt(version.created_at)}` : 'Timestamp unavailable'}
                          {version.output_url ? ' · preview ready' : ' · awaiting usable preview'}
                        </p>
                      </div>
                    </div>
                  </button>
                )) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/40 p-6 text-sm text-slate-400">No takes yet. Approve the lane, estimate generation, and the newest completed output will appear here immediately.</div>
                )}
              </div>
            </section>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-2xl shadow-black/20 xl:col-start-2 xl:col-end-4">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Timeline context</p>
            <span className="font-mono text-xs text-slate-500">{project.visual_identity.aspect_ratio} · {project.scenes.reduce((total, scene) => total + Number(scene.duration_seconds || 0), 0)}s total</span>
          </div>
          <div className="space-y-3 overflow-x-auto p-4">
            {['VIDEO A', 'VIDEO B', 'AUDIO SYNC'].map((track, trackIndex) => (
              <div key={track} className="grid min-w-[680px] grid-cols-[92px_1fr] items-center gap-3">
                <span className="rounded-md border border-white/10 bg-slate-950/60 px-2 py-1.5 text-center font-mono text-[10px] font-bold tracking-wide text-slate-400">{track}</span>
                <div className="relative h-10 rounded-lg border border-white/10 bg-slate-950/55 p-1.5">
                  {trackIndex < 2 && project.scenes.map((scene) => (
                    <button
                      key={`${track}-${scene.id}`}
                      type="button"
                      onClick={() => setSceneId(scene.id)}
                      className={`mr-1 inline-flex h-7 items-center rounded px-2 text-[10px] font-bold transition ${scene.id === sceneId ? 'bg-orange-400 text-slate-950' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`}
                      style={{ width: `${Math.max(10, (Number(scene.duration_seconds || 1) / Math.max(project.scenes.reduce((total, item) => total + Number(item.duration_seconds || 0), 0), 1)) * 100)}%` }}
                    >
                      {scene.title || `Scene ${scene.position}`}
                    </button>
                  ))}
                  {trackIndex === 2 && (
                    <div className="flex h-7 items-center gap-2 overflow-hidden rounded bg-gradient-to-r from-orange-500/20 via-sky-400/20 to-orange-500/20 px-3 text-[11px] text-slate-200">
                      <span className="font-bold uppercase tracking-[0.18em] text-orange-200">Audio Sync</span>
                      <span className="truncate">{selectedScene?.audio_sync || 'Use the dedicated Audio Sync field to persist beat, lyric, and timing notes separately from scene purpose.'}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {message && <p className="border-t border-white/10 px-4 py-3 text-sm text-slate-300">{message}</p>}
        </section>
      </div>

      {showConfirm && quote && (
        <section className="fixed inset-0 z-30 grid place-items-center bg-black/70 px-4">
          <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl shadow-black/40">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-300">Paid generation confirmation</p>
            <h2 className="mt-3 text-2xl font-black tracking-tight text-white">Start paid generation?</h2>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              Maximum debit: <strong>{Number(quote.credits_required || 0)} credits</strong>. The server will recheck the current approval gate before dispatch, reserve credits atomically, and settle actual cost on completion.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" autoFocus onClick={runGeneration} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300" disabled={!gate.allowed || generationBusy}>
                {generationState === 'submitting' ? 'Starting...' : 'Start generation'}
              </button>
              <button type="button" onClick={() => setShowConfirm(false)} className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-slate-200">Cancel</button>
            </div>
            {!gate.allowed && <p className="mt-4 text-sm text-amber-200">{gate.reason}</p>}
          </section>
        </section>
      )}

      {showExportConfirm && exportQuote && (
        <section className="fixed inset-0 z-30 grid place-items-center bg-black/70 px-4">
          <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl shadow-black/40">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-300">Storyboard export</p>
            <h2 className="mt-3 text-2xl font-black tracking-tight text-white">Confirm export</h2>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              This export will charge <strong>{Number(exportQuote.credits_required || 0)} credits</strong> if applicable and will open the completed storyboard artifact in a new tab.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" onClick={confirmStoryboardExport} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold text-slate-950">Create export</button>
              <button type="button" onClick={() => setShowExportConfirm(false)} className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-slate-200">Cancel</button>
            </div>
          </section>
        </section>
      )}
    </main>
  );
}
