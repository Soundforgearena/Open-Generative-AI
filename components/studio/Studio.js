'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Icon, Logo } from './StudioIcons';
import { demoModeEnabled } from '@/lib/demo-mode';
import {
  getAccount,
  getCatalog,
  getProject,
  listProjects,
  preflightGeneration,
  quoteGeneration,
  startGeneration,
  updateProject,
  updateScene,
  uploadReference,
  waitForJob,
} from '@/lib/cinexvideo-client';
import { summarizeProjectReadiness } from '@/lib/billing/generation-preflight.js';
import {
  ANGLES,
  ASPECT_RATIOS,
  FRAME_RATES,
  LENSES,
  MOVEMENTS,
  SHOT_TYPES,
  buildProviderPrompt,
  continuityBetween,
  formatClock,
  normalizeTags,
  parseShotDirection,
  resolutionsFor,
  sceneHealth,
  serializeShotDirection,
  timelineOffsets,
  waveformBars,
} from '@/lib/studio/studio-model';
import { demoStudioData } from '@/lib/studio/demo-studio';

const LANE_LABEL = { music_video: 'Music Video', episode: 'Episode', short_film: 'Short Film', film: 'Short Film' };
const HEALTH_LABEL = { good: 'Good', warning: 'Warning', issue: 'Continuity Issue', pending: 'Not generated' };
const IMAGE_RE = /\.(avif|gif|jpe?g|png|webp)(\?|$)/i;

function safeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  if (value.startsWith('/')) return value;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function mapScene(scene) {
  const versions = scene.versions || [];
  const approved = versions.find((v) => v.approved);
  const latest = versions[0] || null;
  const take = approved || latest;
  const output = safeUrl(take?.output_url || '');
  const thumb = safeUrl(take?.thumbnail_url || '');
  return {
    id: scene.id,
    position: scene.position,
    title: scene.title || `Scene ${scene.position}`,
    purpose: scene.purpose || '',
    prompt: scene.prompt || '',
    shot_direction: scene.shot_direction || '',
    duration_seconds: Number(scene.duration_seconds || 8),
    continuity_locked: Boolean(scene.continuity_locked),
    status: scene.status || 'draft',
    output_url: output,
    thumbnail_url: thumb || (IMAGE_RE.test(output) ? output : ''),
    output_is_image: IMAGE_RE.test(output),
    versions,
  };
}

function relativeTime(date, now) {
  if (!date) return '';
  const s = Math.max(0, Math.round((now - date) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

/* -------------------------------------------------------------- primitives */

function Select({ label, value, options, onChange, id, disabled }) {
  return (
    <label className="sx-field" htmlFor={id}>
      <span className="sx-field-label">{label}</span>
      <span className="sx-select-wrap">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          {options.map((o) => (typeof o === 'string'
            ? <option key={o} value={o}>{o}</option>
            : <option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
        <Icon.ChevronDown className="sx-select-caret" />
      </span>
    </label>
  );
}

function Section({ icon: I, title, open, onToggle, children, aside }) {
  return (
    <section className={`sx-section ${open ? 'is-open' : ''}`}>
      <button type="button" className="sx-section-head" onClick={onToggle} aria-expanded={open}>
        <I className="sx-section-icon" />
        <span>{title}</span>
        {aside}
        {open ? <Icon.ChevronUp className="sx-section-caret" /> : <Icon.ChevronDown className="sx-section-caret" />}
      </button>
      {open && <div className="sx-section-body">{children}</div>}
    </section>
  );
}

function Thumb({ scene, className = '' }) {
  if (scene?.thumbnail_url) return <img className={`sx-thumb ${className}`} src={scene.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" />;
  if (scene?.output_url) return <video className={`sx-thumb ${className}`} src={scene.output_url} muted playsInline preload="metadata" />;
  return (
    <span className={`sx-thumb sx-thumb-empty ${className}`} aria-hidden="true">
      <span>{String(scene?.position || '').padStart(2, '0')}</span>
    </span>
  );
}

function Waveform({ peaks, progress = -1, className = '' }) {
  return (
    <span className={`sx-wave ${className}`} aria-hidden="true">
      {peaks.map((p, i) => (
        <i key={i} style={{ height: `${Math.round(p * 100)}%` }} className={progress >= 0 && i / peaks.length <= progress ? 'is-played' : ''} />
      ))}
    </span>
  );
}

/* --------------------------------------------------------------- studio */

export default function Studio() {
  const router = useRouter();
  const search = useSearchParams();
  const projectParam = search.get('project') || '';

  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [project, setProject] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [assets, setAssets] = useState([]);
  const [projects, setProjects] = useState([]);
  const [videoOptions, setVideoOptions] = useState([]);
  const [credits, setCredits] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [aspect, setAspect] = useState('16:9');
  const [savedAt, setSavedAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState('');
  const [tab, setTab] = useState('inspector');
  const [open, setOpen] = useState({ visual: true, camera: true, continuity: true, audio: true, generation: true });
  const [promptOpen, setPromptOpen] = useState(true);
  const [tagDraft, setTagDraft] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [sequence, setSequence] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [listMode, setListMode] = useState('detail');
  const [sortDesc, setSortDesc] = useState(false);
  const [menu, setMenu] = useState('');
  const [modelKey, setModelKey] = useState('');
  const [genDialog, setGenDialog] = useState(null);
  const [genState, setGenState] = useState('idle');
  const [readiness, setReadiness] = useState(null);
  const [audioPeaks, setAudioPeaks] = useState(null);
  const [uploading, setUploading] = useState(false);

  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const stageRef = useRef(null);
  const dirty = useRef(new Map());
  const projectDirty = useRef(null);
  const saveTimer = useRef(null);
  const genLock = useRef(false);

  /* ------------------------------------------------------------- loading */

  const applyProject = useCallback((result) => {
    const mapped = (result.scenes || []).map(mapScene).sort((a, b) => a.position - b.position);
    setProject({
      id: result.project.id,
      title: result.project.title || 'Untitled project',
      lane: result.project.lane,
      visual_identity: result.project.visual_identity || {},
    });
    setAspect(result.project.visual_identity?.aspect_ratio || '16:9');
    setScenes(mapped);
    setAssets(result.assets || []);
    setSelectedId((current) => (mapped.some((s) => s.id === current) ? current : mapped[0]?.id || ''));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadState('loading');
      try {
        if (demoModeEnabled) {
          const demo = demoStudioData();
          applyProject(demo.result);
          setProjects(demo.projects);
          setVideoOptions(demo.options);
          setModelKey(demo.options[0].model);
          setCredits(demo.credits);
          setSavedAt(new Date(Date.now() - 120000));
          setLoadState('ready');
          return;
        }
        const [account, catalog, list] = await Promise.all([getAccount(), getCatalog(), listProjects()]);
        if (cancelled) return;
        const all = list.projects || [];
        setProjects(all);
        setCredits(Number(account.credits ?? 0));
        const opts = (catalog.options || []).filter((o) => o.operation === 'video');
        setVideoOptions(opts);
        setModelKey((k) => k || opts[0]?.model || '');
        const targetId = projectParam || all[0]?.id;
        if (!targetId) { setLoadState('empty'); return; }
        const result = await getProject(targetId);
        if (cancelled) return;
        if (!result?.project) { setLoadState('missing'); return; }
        applyProject(result);
        setSavedAt(null);
        setLoadState('ready');
      } catch (error) {
        if (cancelled) return;
        setLoadError(error.message || 'The studio could not be loaded.');
        setLoadState(error.status === 401 ? 'signin' : 'error');
      }
    }
    load();
    return () => { cancelled = true; };
  }, [projectParam, applyProject]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 20000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => setToast(''), 4200);
    return () => window.clearTimeout(t);
  }, [toast]);

  /* ------------------------------------------------------- derived state */

  const ordered = useMemo(() => (sortDesc ? [...scenes].reverse() : scenes), [scenes, sortDesc]);
  const index = Math.max(0, scenes.findIndex((s) => s.id === selectedId));
  const scene = scenes[index] || null;
  const controls = useMemo(() => parseShotDirection(scene?.shot_direction), [scene?.shot_direction]);
  const offsets = useMemo(() => timelineOffsets(scenes), [scenes]);
  const total = offsets.length ? offsets[offsets.length - 1].end : 0;
  const vi = project?.visual_identity || {};
  const styleName = vi.style || 'Cinematic';
  const styleTags = normalizeTags(vi.style_tags || ['cinematic', 'dramatic', 'film']);
  const videoOption = videoOptions.find((o) => o.model === modelKey) || videoOptions[0] || null;
  const resolutions = resolutionsFor(videoOption?.max_resolution);
  const audioAsset = assets.find((a) => a.kind === 'audio' && a.preview_url);
  const imageAssets = assets.filter((a) => a.kind !== 'audio');
  const styleThumb = imageAssets.find((a) => a.preview_url)?.preview_url || scenes.find((s) => s.thumbnail_url)?.thumbnail_url || '';
  const continuity = continuityBetween(scene, scenes[index + 1]);
  const healthCounts = useMemo(() => scenes.reduce((acc, s) => { acc[sceneHealth(s)] += 1; return acc; }, { good: 0, warning: 0, issue: 0, pending: 0 }), [scenes]);
  const globalTime = (offsets[index]?.start || 0) + playhead;

  const scenePeaks = useCallback((s) => {
    if (!audioPeaks || !total) return waveformBars(s.id, 44);
    const off = offsets.find((o) => o.id === s.id);
    const from = Math.floor((off.start / total) * audioPeaks.length);
    const to = Math.max(from + 1, Math.floor((off.end / total) * audioPeaks.length));
    const slice = audioPeaks.slice(from, to);
    const out = [];
    for (let i = 0; i < 44; i += 1) out.push(slice[Math.floor((i / 44) * slice.length)] ?? 0.1);
    return out;
  }, [audioPeaks, offsets, total]);

  /* ---------------------------------------------------------- audio peaks */

  useEffect(() => {
    if (!audioAsset?.preview_url) { setAudioPeaks(null); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(audioAsset.preview_url);
        const buf = await res.arrayBuffer();
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        const audio = await ctx.decodeAudioData(buf);
        const data = audio.getChannelData(0);
        const n = 600;
        const step = Math.floor(data.length / n) || 1;
        const peaks = [];
        let max = 0;
        for (let i = 0; i < n; i += 1) {
          let peak = 0;
          for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 8) peak = Math.max(peak, Math.abs(data[j]));
          peaks.push(peak); max = Math.max(max, peak);
        }
        ctx.close?.();
        if (!cancelled) setAudioPeaks(peaks.map((p) => Math.max(0.08, p / (max || 1))));
      } catch {
        if (!cancelled) setAudioPeaks(null);
      }
    })();
    return () => { cancelled = true; };
  }, [audioAsset?.preview_url]);

  /* ------------------------------------------------------------ autosave */

  const flush = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    const scenePatches = [...dirty.current.entries()];
    const projectPatch = projectDirty.current;
    dirty.current.clear();
    projectDirty.current = null;
    if (!scenePatches.length && !projectPatch) return;
    if (demoModeEnabled) { setSavedAt(new Date()); return; }
    setSaving(true);
    try {
      await Promise.all([
        ...scenePatches.map(([id, patch]) => updateScene(id, patch)),
        projectPatch ? updateProject(project.id, projectPatch) : null,
      ]);
      setSavedAt(new Date());
    } catch (error) {
      scenePatches.forEach(([id, patch]) => dirty.current.set(id, { ...patch, ...(dirty.current.get(id) || {}) }));
      setToast(error.message || 'Autosave failed. Retrying shortly.');
      saveTimer.current = window.setTimeout(() => flush(), 5000);
    } finally {
      setSaving(false);
    }
  }, [project?.id]);

  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => flush(), 1100);
  }, [flush]);

  useEffect(() => {
    const beforeUnload = (e) => {
      if (dirty.current.size || projectDirty.current) { flush(); e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [flush]);

  function patchScene(id, patch) {
    setScenes((cur) => cur.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    dirty.current.set(id, { ...(dirty.current.get(id) || {}), ...patch });
    scheduleSave();
  }

  function patchControls(patch) {
    if (!scene) return;
    patchScene(scene.id, { shot_direction: serializeShotDirection({ ...controls, ...patch }) });
  }

  function patchVisualIdentity(patch) {
    setProject((p) => ({ ...p, visual_identity: { ...p.visual_identity, ...patch } }));
    projectDirty.current = { visual_identity: { ...(projectDirty.current?.visual_identity || {}), ...patch } };
    scheduleSave();
  }

  function renameProject(title) {
    setProject((p) => ({ ...p, title }));
    if (title.trim()) { projectDirty.current = { ...(projectDirty.current || {}), title }; scheduleSave(); }
  }

  /* ------------------------------------------------------------ playback */

  const selectScene = useCallback((id, { keepPlaying = false } = {}) => {
    setSelectedId(id);
    setPlayhead(0);
    if (!keepPlaying) { setPlaying(false); setSequence(false); }
  }, []);

  const step = useCallback((dir) => {
    if (!scenes.length) return;
    const next = scenes[(index + dir + scenes.length) % scenes.length];
    selectScene(next.id);
  }, [index, scenes, selectScene]);

  const hasVideo = Boolean(scene?.output_url && !scene.output_is_image);

  useEffect(() => {
    const v = videoRef.current;
    if (!hasVideo || !v) return;
    if (playing) v.play().catch(() => setPlaying(false)); else v.pause();
  }, [playing, hasVideo, selectedId]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      if (Math.abs(a.currentTime - globalTime) > 0.35) a.currentTime = globalTime;
      a.play().catch(() => {});
    } else a.pause();
  }, [playing, globalTime]);

  const advance = useCallback(() => {
    if (sequence && index < scenes.length - 1) {
      selectScene(scenes[index + 1].id, { keepPlaying: true });
    } else {
      setPlaying(false); setSequence(false); setPlayhead(scene?.duration_seconds || 0);
    }
  }, [sequence, index, scenes, scene, selectScene]);

  useEffect(() => {
    if (!playing || hasVideo || !scene) return undefined;
    const started = performance.now() - playhead * 1000;
    let raf;
    const tick = (t) => {
      const elapsed = (t - started) / 1000;
      if (elapsed >= scene.duration_seconds) { advance(); return; }
      setPlayhead(elapsed);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // playhead intentionally excluded: the loop owns it while playing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, hasVideo, scene?.id, advance]);

  function togglePlay() {
    if (!scene) return;
    if (!playing && playhead >= scene.duration_seconds - 0.05) setPlayhead(0);
    setPlaying((p) => !p);
  }

  function playSequence() {
    if (!scenes.length) return;
    selectScene(scenes[0].id, { keepPlaying: true });
    setSequence(true);
    setPlaying(true);
  }

  function seekGlobal(seconds) {
    const t = Math.max(0, Math.min(total - 0.01, seconds));
    const hit = offsets.find((o) => t >= o.start && t < o.end) || offsets[offsets.length - 1];
    if (!hit) return;
    if (hit.id !== selectedId) setSelectedId(hit.id);
    const local = t - hit.start;
    setPlayhead(local);
    if (videoRef.current && hasVideo && hit.id === selectedId) videoRef.current.currentTime = local;
  }

  function fullscreen() {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  }

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target?.isContentEditable) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'Escape') { setMenu(''); setGenDialog(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ---------------------------------------------------------- generation */

  function payloadFor(s) {
    const c = parseShotDirection(s.shot_direction);
    const duration = Math.min(Number(s.duration_seconds || 5), Number(videoOption?.max_duration_seconds || 10));
    return {
      model: videoOption.model,
      operation: 'video',
      project_id: project.id,
      scene_id: s.id,
      duration_seconds: duration,
      resolution: c.resolution,
      input: {
        prompt: buildProviderPrompt({ prompt: s.prompt || s.purpose || s.title, controls: c, style: [styleName, vi.style_notes].filter(Boolean).join(', ') }),
        aspect_ratio: aspect,
        duration,
        resolution: c.resolution,
      },
    };
  }

  async function openGenerate() {
    if (!scene || !videoOption) { setToast('No video model is available right now.'); return; }
    await flush();
    if (demoModeEnabled) { setGenDialog({ scope: 'scene', byScene: { [scene.id]: 8 }, total: 8, all: { total: 8 * scenes.length } }); return; }
    setGenState('quoting');
    try {
      const quotes = await Promise.all(scenes.map(async (s) => [s.id, Number((await quoteGeneration(payloadFor(s))).credits_required)]));
      const byScene = Object.fromEntries(quotes);
      setGenDialog({ scope: 'scene', byScene, total: byScene[scene.id], all: { total: quotes.reduce((t, [, c]) => t + c, 0) } });
    } catch (error) {
      setToast(error.message || 'The generation price could not be calculated.');
    } finally {
      setGenState('idle');
    }
  }

  async function confirmGenerate() {
    if (genLock.current || !genDialog) return;
    const targets = genDialog.scope === 'all' ? scenes : [scene];
    const needed = genDialog.scope === 'all' ? genDialog.all.total : genDialog.total;
    if (credits !== null && needed > credits) { setToast(`You need ${needed} credits and have ${credits}. Add credits from Account and billing.`); return; }
    if (demoModeEnabled) { setGenDialog(null); setToast('Demo mode: generation is simulated and spends nothing.'); return; }
    genLock.current = true;
    const dialog = genDialog;
    setGenDialog(null);
    setGenState('running');
    let failed = 0;
    try {
      for (const s of targets) {
        setScenes((cur) => cur.map((x) => (x.id === s.id ? { ...x, status: 'generating' } : x)));
        setToast(`Generating ${s.title}...`);
        const job = await startGeneration({ ...payloadFor(s), confirmed_max_credits: dialog.byScene[s.id] });
        const result = await waitForJob(job.request_id);
        if (result.status !== 'completed') failed += 1;
      }
      const [fresh, account] = await Promise.all([getProject(project.id), getAccount()]);
      applyProject(fresh);
      setCredits(Number(account.credits ?? 0));
      setToast(failed ? `${failed} scene${failed > 1 ? 's' : ''} failed. Credits for failed scenes were returned.` : 'Generation complete. New takes are ready to review.');
    } catch (error) {
      setToast(error.status === 402 ? 'Not enough credits. Open Account and billing to add more.' : error.message || 'Generation could not be started.');
      try { applyProject(await getProject(project.id)); } catch { /* keep local state */ }
    } finally {
      genLock.current = false;
      setGenState('idle');
    }
  }

  async function checkReadiness() {
    if (!videoOption || !scenes.length) return;
    await flush();
    if (demoModeEnabled) { setReadiness({ ready: true, totalCredits: 8 * scenes.length, balance: credits, problems: [] }); return; }
    setGenState('checking');
    try {
      const reports = await Promise.all(scenes.map((s) => preflightGeneration(payloadFor(s))));
      setReadiness(summarizeProjectReadiness(reports));
    } catch (error) {
      setReadiness({ ready: false, totalCredits: null, balance: credits, problems: [error.message || 'Readiness could not be checked.'] });
    } finally {
      setGenState('idle');
    }
  }

  async function approveTake(version) {
    if (!scene) return;
    try {
      if (!demoModeEnabled) {
        await updateScene(scene.id, { approve_version: version });
        applyProject(await getProject(project.id));
      }
      setToast(`Take ${version} approved for ${scene.title}.`);
    } catch (error) {
      setToast(error.message || 'That take could not be approved.');
    }
  }

  async function onUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !project) return;
    if (demoModeEnabled) { setToast('Demo mode: uploads are disabled.'); return; }
    setUploading(true);
    try {
      const kind = file.type.startsWith('audio/') ? 'audio' : 'reference';
      await uploadReference(project.id, file, { kind, name: file.name });
      const fresh = await getProject(project.id);
      setAssets(fresh.assets || []);
      setToast(`${file.name} uploaded.`);
    } catch (error) {
      setToast(error.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  /* --------------------------------------------------------------- views */

  if (loadState !== 'ready') {
    const copy = {
      loading: ['Loading your studio', 'Preparing scenes, credits and the Flight Path...'],
      empty: ['No projects yet', 'Start a project and your scenes will open here.'],
      missing: ['Project not found', 'This project does not exist or is not yours.'],
      signin: ['Sign in to open the studio', 'Your projects and credits stay private to your account.'],
      error: ['The studio could not load', loadError],
    }[loadState];
    return (
      <main className="sx-root sx-state">
        <div className="sx-state-card">
          <Logo />
          <h1>{copy[0]}</h1>
          <p>{copy[1]}</p>
          {loadState === 'loading' ? <span className="sx-spinner" aria-hidden="true" /> : (
            <div className="sx-state-actions">
              {loadState === 'signin' && <Link className="sx-btn sx-btn-gold" href="/auth?next=/studio">Sign in</Link>}
              <Link className="sx-btn" href="/create">Start a project</Link>
              <Link className="sx-btn" href="/dashboard">Dashboard</Link>
            </div>
          )}
        </div>
      </main>
    );
  }

  const tagsShown = controls.tags.length ? controls.tags : [];
  const pxPerSecond = 10 * zoom;
  const generating = genState === 'running';

  return (
    <main className="sx-root" onClick={() => menu && setMenu('')}>
      {/* ------------------------------------------------------- top bar */}
      <header className="sx-top">
        <Link href="/dashboard" className="sx-brand" aria-label="CinexVideo dashboard">
          <Logo /><span className="sx-wordmark">CINEXVIDEO</span>
        </Link>
        <span className="sx-studio-label">AI VIDEO CREATION STUDIO</span>

        <div className="sx-project" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="sx-project-btn" onClick={() => setMenu(menu === 'project' ? '' : 'project')} aria-haspopup="listbox" aria-expanded={menu === 'project'}>
            <span className="sx-project-title">{project.title}</span>
            <Icon.ChevronDown />
          </button>
          <span className="sx-project-meta">{LANE_LABEL[project.lane] ? `${LANE_LABEL[project.lane]} • ` : ''}{styleName} • {scenes.length} scenes • {formatClock(total)}</span>
          {menu === 'project' && (
            <div className="sx-menu sx-project-menu" role="listbox">
              <label className="sx-menu-rename">
                <span>Project title</span>
                <input value={project.title} onChange={(e) => renameProject(e.target.value)} maxLength={200} />
              </label>
              <p className="sx-menu-heading">Switch project</p>
              {projects.map((p) => (
                <button key={p.id} type="button" role="option" aria-selected={p.id === project.id} className={p.id === project.id ? 'is-active' : ''}
                  onClick={async () => { setMenu(''); await flush(); router.push(`/studio?project=${encodeURIComponent(p.id)}`); }}>
                  {p.title || 'Untitled project'}
                </button>
              ))}
              <Link href="/create" className="sx-menu-new"><Icon.Plus /> New project</Link>
            </div>
          )}
        </div>

        <span className={`sx-autosave ${saving ? 'is-saving' : ''}`} role="status">
          <Icon.CheckCircle />{saving ? 'Saving...' : savedAt ? `Autosaved ${relativeTime(savedAt, now)}` : 'All changes autosave'}
        </span>

        <div className="sx-top-actions">
          <Link href="/account" className="sx-credits" title="Credits and billing">
            <Icon.Coin className="sx-coin" />
            <span>{credits === null ? '—' : credits.toLocaleString()} credits</span>
            <Icon.ChevronDown />
          </Link>
          <button type="button" className="sx-btn sx-btn-ghost" onClick={playSequence} disabled={!scenes.length}><Icon.Play /> Preview</button>
          <button type="button" className="sx-btn sx-btn-gold" onClick={openGenerate} disabled={!scene || generating || genState === 'quoting'}>
            <Icon.Spark /> {generating ? 'Generating...' : genState === 'quoting' ? 'Pricing...' : 'Generate'}
          </button>
        </div>
      </header>

      <div className="sx-body">
        {/* ------------------------------------------------------ scenes */}
        <aside className="sx-scenes sx-panel" aria-label="Scenes">
          <div className="sx-panel-head">
            <h2>SCENES <span className="sx-count">{scenes.length}</span></h2>
            <div className="sx-head-tools">
              <button type="button" aria-label="Reverse scene order" aria-pressed={sortDesc} onClick={() => setSortDesc((v) => !v)}><Icon.Sort /></button>
              <button type="button" aria-label="Toggle compact list" aria-pressed={listMode === 'compact'} onClick={() => setListMode((m) => (m === 'compact' ? 'detail' : 'compact'))}><Icon.List /></button>
              <button type="button" aria-label="Open scene in project editor" onClick={() => router.push(`/projects/${encodeURIComponent(project.id)}`)}><Icon.Expand /></button>
            </div>
          </div>
          <ol className={`sx-scene-list ${listMode === 'compact' ? 'is-compact' : ''}`}>
            {ordered.map((s) => {
              const h = sceneHealth(s);
              return (
                <li key={s.id}>
                  <button type="button" className={`sx-scene ${s.id === selectedId ? 'is-active' : ''}`} onClick={() => selectScene(s.id)} aria-current={s.id === selectedId}>
                    <span className="sx-scene-thumb"><Thumb scene={s} /></span>
                    <span className="sx-scene-text">
                      <span className="sx-scene-row">
                        <span className={`sx-scene-num ${s.id === selectedId ? 'is-active' : ''}`}>{s.position}</span>
                        <strong>{s.title}</strong>
                        <span className={`sx-dot is-${h}`} title={HEALTH_LABEL[h]} />
                      </span>
                      <span className="sx-scene-time">{formatClock(s.duration_seconds)}</span>
                      {listMode !== 'compact' && <span className="sx-scene-desc">{s.purpose || s.prompt || 'No description yet.'}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        {/* ------------------------------------------------------ center */}
        <section className="sx-center">
          <div className="sx-stage sx-panel" ref={stageRef}>
            <div className={`sx-frame ratio-${aspect.replace(':', 'x')}`}>
              {scene?.output_url && !scene.output_is_image ? (
                <video key={scene.id} ref={videoRef} className="sx-media" src={scene.output_url} poster={scene.thumbnail_url || undefined} playsInline
                  onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)} onEnded={advance} />
              ) : scene?.thumbnail_url ? (
                <img key={scene.id} className={`sx-media ${playing ? 'is-kenburns' : ''}`} src={scene.thumbnail_url} alt={scene.title} referrerPolicy="no-referrer" style={{ animationDuration: `${scene.duration_seconds}s` }} />
              ) : (
                <div className="sx-media sx-media-empty">
                  <span className="sx-empty-kicker">Scene {scene?.position} · not generated yet</span>
                  <strong>{scene?.title}</strong>
                  <p>{scene?.prompt || scene?.purpose || 'Write the AI prompt below, then press Generate.'}</p>
                </div>
              )}
              <div className="sx-stage-top">
                <div className="sx-pill sx-scene-nav">
                  <button type="button" aria-label="Previous scene" onClick={() => step(-1)}><Icon.ChevronLeft /></button>
                  <span>Scene {index + 1} / {scenes.length}</span>
                  <button type="button" aria-label="Next scene" onClick={() => step(1)}><Icon.ChevronRight /></button>
                </div>
                <div className="sx-pill sx-ratio" onClick={(e) => e.stopPropagation()}>
                  <button type="button" onClick={() => setMenu(menu === 'ratio' ? '' : 'ratio')} aria-haspopup="listbox" aria-expanded={menu === 'ratio'}>
                    <Icon.Ratio /> {aspect} <Icon.ChevronDown />
                  </button>
                  {menu === 'ratio' && (
                    <div className="sx-menu sx-ratio-menu" role="listbox">
                      {ASPECT_RATIOS.map((r) => (
                        <button key={r} type="button" role="option" aria-selected={r === aspect} className={r === aspect ? 'is-active' : ''}
                          onClick={() => { setAspect(r); patchVisualIdentity({ aspect_ratio: r }); setMenu(''); }}>{r}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <input className="sx-scrub" type="range" min="0" max={scene?.duration_seconds || 1} step="0.05" value={Math.min(playhead, scene?.duration_seconds || 1)}
              aria-label="Scrub scene" onChange={(e) => { const t = Number(e.target.value); setPlayhead(t); if (videoRef.current && hasVideo) videoRef.current.currentTime = t; }} />
            </div>
            <div className="sx-transport">
              <span className="sx-time">{formatClock(playhead)} / {formatClock(scene?.duration_seconds)}</span>
              <div className="sx-transport-main">
                <button type="button" aria-label="Previous scene" onClick={() => step(-1)}><Icon.Prev /></button>
                <button type="button" className="sx-play" aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>{playing ? <Icon.Pause /> : <Icon.Play />}</button>
                <button type="button" aria-label="Next scene" onClick={() => step(1)}><Icon.Next /></button>
              </div>
              <div className="sx-transport-side" onClick={(e) => e.stopPropagation()}>
                <button type="button" aria-label="Fit frame" aria-pressed={zoom === 1} onClick={() => setZoom(1)}><Icon.Fit /></button>
                <button type="button" aria-label="Full screen" onClick={fullscreen}><Icon.Expand /></button>
                <button type="button" aria-label="More options" onClick={() => setMenu(menu === 'more' ? '' : 'more')}><Icon.More /></button>
                {menu === 'more' && (
                  <div className="sx-menu sx-more-menu">
                    <button type="button" onClick={() => { setMenu(''); checkReadiness(); }}>Check readiness (free)</button>
                    {scene?.output_url && <a href={scene.output_url} target="_blank" rel="noreferrer">Open current take</a>}
                    <Link href={`/projects/${encodeURIComponent(project.id)}`}>Open project editor</Link>
                    <Link href="/create/director">AI Director Writing Room</Link>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="sx-lower">
            <div className="sx-prompt sx-panel">
              <div className="sx-panel-head sx-panel-head-sm">
                <h3><Icon.Spark /> AI PROMPT</h3>
                <button type="button" aria-label={promptOpen ? 'Collapse prompt' : 'Expand prompt'} onClick={() => setPromptOpen((v) => !v)}>{promptOpen ? <Icon.Close /> : <Icon.ChevronDown />}</button>
              </div>
              {promptOpen && (
                <>
                  <textarea className="sx-prompt-input" value={scene?.prompt || ''} placeholder="Describe the shot: subject, action, setting, lighting and mood." maxLength={5000} aria-label="AI prompt"
                    onChange={(e) => scene && patchScene(scene.id, { prompt: e.target.value })} />
                  <div className="sx-tags">
                    {tagsShown.map((t) => (
                      <button key={t} type="button" className="sx-tag" onClick={() => patchControls({ tags: controls.tags.filter((x) => x !== t) })} aria-label={`Remove tag ${t}`}>
                        {t}<Icon.Close className="sx-tag-x" />
                      </button>
                    ))}
                    {tagDraft !== null ? (
                      <input className="sx-tag-input" autoFocus value={tagDraft} placeholder="tag" maxLength={32}
                        onChange={(e) => setTagDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && tagDraft.trim()) { patchControls({ tags: [...controls.tags, tagDraft] }); setTagDraft(''); }
                          if (e.key === 'Escape') setTagDraft(null);
                        }}
                        onBlur={() => { if (tagDraft.trim()) patchControls({ tags: [...controls.tags, tagDraft] }); setTagDraft(null); }} />
                    ) : (
                      <button type="button" className="sx-tag-add" aria-label="Add tag" onClick={() => setTagDraft('')}><Icon.Plus /></button>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="sx-shot sx-panel">
              <div className="sx-panel-head sx-panel-head-sm"><h3><Icon.Camera /> SHOT CONTROLS</h3></div>
              <div className="sx-shot-grid">
                <Select id="sc-shot" label={<><Icon.Camera /> Shot Type</>} value={controls.shot} options={SHOT_TYPES} onChange={(v) => patchControls({ shot: v })} />
                <Select id="sc-move" label={<><Icon.Route /> Movement</>} value={controls.movement} options={MOVEMENTS} onChange={(v) => patchControls({ movement: v })} />
                <Select id="sc-angle" label={<><Icon.Sliders /> Angle</>} value={controls.angle} options={ANGLES} onChange={(v) => patchControls({ angle: v })} />
                <Select id="sc-lens" label={<><Icon.Eye /> Lens</>} value={controls.lens} options={LENSES} onChange={(v) => patchControls({ lens: v })} />
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ inspector */}
        <aside className="sx-inspector sx-panel" aria-label="Inspector">
          <div className="sx-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'inspector'} className={tab === 'inspector' ? 'is-active' : ''} onClick={() => setTab('inspector')}><Icon.Inspector /> INSPECTOR</button>
            <button type="button" role="tab" aria-selected={tab === 'assets'} className={tab === 'assets' ? 'is-active' : ''} onClick={() => setTab('assets')}><Icon.Folder /> ASSETS</button>
            <button type="button" className="sx-tab-tool" aria-label="Expand all sections" onClick={() => { const all = Object.values(open).every(Boolean); setOpen({ visual: !all, camera: !all, continuity: !all, audio: !all, generation: !all }); }}><Icon.Expand /></button>
          </div>

          {tab === 'inspector' ? (
            <div className="sx-inspector-body">
              <Section icon={Icon.Eye} title="Visual Direction" open={open.visual} onToggle={() => setOpen((o) => ({ ...o, visual: !o.visual }))}>
                <div className="sx-vd">
                  <span className="sx-vd-thumb">{styleThumb ? <img src={styleThumb} alt="" referrerPolicy="no-referrer" /> : <span className="sx-thumb-empty" />}</span>
                  <div className="sx-vd-text">
                    <input className="sx-inline-input sx-vd-title" value={styleName} onChange={(e) => patchVisualIdentity({ style: e.target.value })} aria-label="Visual style" maxLength={120} />
                    <textarea className="sx-inline-input sx-vd-notes" rows={2} value={vi.style_notes ?? 'Moody lighting, dramatic contrast, rich color grading, filmic look.'} onChange={(e) => patchVisualIdentity({ style_notes: e.target.value })} aria-label="Style notes" maxLength={1000} />
                  </div>
                </div>
                <div className="sx-chips">
                  {styleTags.map((t) => (
                    <button key={t} type="button" className="sx-chip" aria-label={`Remove style tag ${t}`} onClick={() => patchVisualIdentity({ style_tags: styleTags.filter((x) => x !== t) })}>{t}</button>
                  ))}
                  <button type="button" className="sx-chip sx-chip-add" aria-label="Add style tag" onClick={() => { const t = window.prompt('Add a style tag'); if (t) patchVisualIdentity({ style_tags: normalizeTags([...styleTags, t]) }); }}><Icon.Plus /></button>
                </div>
              </Section>

              <Section icon={Icon.Camera} title="Camera" open={open.camera} onToggle={() => setOpen((o) => ({ ...o, camera: !o.camera }))}>
                <div className="sx-rows">
                  <Select id="in-shot" label="Shot Type" value={controls.shot} options={SHOT_TYPES} onChange={(v) => patchControls({ shot: v })} />
                  <Select id="in-move" label="Movement" value={controls.movement} options={MOVEMENTS} onChange={(v) => patchControls({ movement: v })} />
                  <Select id="in-angle" label="Angle" value={controls.angle} options={ANGLES} onChange={(v) => patchControls({ angle: v })} />
                  <Select id="in-lens" label="Lens" value={controls.lens} options={LENSES} onChange={(v) => patchControls({ lens: v })} />
                </div>
              </Section>

              <Section icon={Icon.Link} title="Continuity" open={open.continuity} onToggle={() => setOpen((o) => ({ ...o, continuity: !o.continuity }))}>
                <div className="sx-cont">
                  <div className="sx-cont-row">
                    <strong>{scenes[index + 1] ? `Scene ${index + 1} → ${index + 2}` : `Scene ${index + 1}`}</strong>
                    <Icon.Shield className="sx-cont-shield" />
                    <span className={`sx-status is-${continuity.state}`}>{continuity.label} {continuity.state === 'good' && <Icon.CheckCircle />}</span>
                  </div>
                  <div className="sx-cont-row sx-muted">
                    <span>Match: {continuity.matches.length ? continuity.matches.join(', ') : 'Lock continuity to match'}</span>
                    {continuity.state === 'good' && <Icon.Check className="sx-ok" />}
                  </div>
                  <label className="sx-toggle">
                    <input type="checkbox" checked={Boolean(scene?.continuity_locked)} onChange={(e) => scene && patchScene(scene.id, { continuity_locked: e.target.checked })} />
                    <span className="sx-toggle-track" aria-hidden="true" />
                    <span>Lock continuity for this scene</span>
                  </label>
                </div>
              </Section>

              <Section icon={Icon.Wave} title="Audio Sync" open={open.audio} onToggle={() => setOpen((o) => ({ ...o, audio: !o.audio }))}>
                <div className="sx-audio">
                  <span className="sx-audio-label">Voice <span className="sx-muted">/ Music / SFX</span></span>
                  <Waveform peaks={scene ? scenePeaks(scene) : []} className="sx-audio-wave" />
                  <span className={`sx-status ${audioAsset ? 'is-good' : 'is-warning'}`}>{audioAsset ? <>Aligned <Icon.CheckCircle /></> : 'No track'}</span>
                </div>
                {audioAsset ? (
                  <p className="sx-hint">{audioAsset.name} · plays in sync with Preview</p>
                ) : (
                  <button type="button" className="sx-link-btn" onClick={() => setTab('assets')}>Upload a song or voice track</button>
                )}
              </Section>

              <Section icon={Icon.Spark} title="Generation" open={open.generation} onToggle={() => setOpen((o) => ({ ...o, generation: !o.generation }))}>
                <div className="sx-rows">
                  <Select id="gen-model" label="Model" value={videoOption?.model || ''} options={videoOptions.length ? videoOptions.map((o) => ({ value: o.model, label: o.label })) : [{ value: '', label: 'Unavailable' }]} onChange={setModelKey} disabled={!videoOptions.length} />
                  <Select id="gen-res" label="Resolution" value={resolutions.some((r) => r.value === controls.resolution) ? controls.resolution : resolutions[0].value} options={resolutions} onChange={(v) => patchControls({ resolution: v })} />
                  <Select id="gen-fps" label="Frames" value={controls.fps} options={FRAME_RATES} onChange={(v) => patchControls({ fps: v })} />
                  <label className="sx-field" htmlFor="gen-dur">
                    <span className="sx-field-label">Duration</span>
                    <span className="sx-number">
                      <input id="gen-dur" type="number" min="1" max={videoOption?.max_duration_seconds || 10} value={scene?.duration_seconds || 5}
                        onChange={(e) => scene && patchScene(scene.id, { duration_seconds: Math.max(1, Math.min(Number(videoOption?.max_duration_seconds || 10), Math.round(Number(e.target.value) || 1))) })} />
                      <span>sec</span>
                    </span>
                  </label>
                </div>
                <button type="button" className="sx-btn sx-btn-ghost sx-ready-btn" onClick={checkReadiness} disabled={genState === 'checking' || !videoOption}>
                  <Icon.Shield /> {genState === 'checking' ? 'Checking...' : 'Check readiness (free)'}
                </button>
                {readiness && (
                  <div className={`sx-readiness ${readiness.ready ? 'is-ready' : 'is-blocked'}`} role="status">
                    <strong>{readiness.ready ? 'Ready to generate' : 'Not ready yet'}</strong>
                    {readiness.totalCredits !== null && <span>{readiness.totalCredits} credits for all scenes · {readiness.balance} available · 0 charged</span>}
                    {readiness.problems.map((p) => <span key={p} className="sx-problem">{p}</span>)}
                  </div>
                )}
                {scene?.versions?.length > 0 && (
                  <div className="sx-takes">
                    <p className="sx-menu-heading">Takes</p>
                    {scene.versions.map((v) => (
                      <div key={v.id || v.version} className="sx-take">
                        <span>Take {v.version} · {v.status}</span>
                        {v.approved ? <span className="sx-status is-good">Approved</span> : v.status === 'completed' && <button type="button" className="sx-link-btn" onClick={() => approveTake(v.version)}>Approve</button>}
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </div>
          ) : (
            <div className="sx-inspector-body sx-assets">
              <label className={`sx-upload ${uploading ? 'is-busy' : ''}`}>
                <input type="file" accept="image/jpeg,image/png,image/webp,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg,audio/flac" onChange={onUpload} disabled={uploading} />
                <Icon.Upload /> {uploading ? 'Uploading...' : 'Upload image or audio'}
                <small>JPG, PNG, WebP, MP3, WAV, AAC, OGG, FLAC · up to 60 MB · private</small>
              </label>
              {assets.length === 0 && <p className="sx-hint">No assets yet. References and audio you upload appear here.</p>}
              <ul className="sx-asset-list">
                {assets.map((a) => (
                  <li key={a.id} className="sx-asset">
                    {a.kind === 'audio' ? <span className="sx-asset-icon"><Icon.Wave /></span> : a.preview_url ? <img src={a.preview_url} alt="" referrerPolicy="no-referrer" /> : <span className="sx-asset-icon"><Icon.Folder /></span>}
                    <span className="sx-asset-text"><strong>{a.name}</strong><small>{a.kind}{a.locked ? ' · locked' : ''}</small></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      {/* --------------------------------------------------- flight path */}
      <section className="sx-flight sx-panel" aria-label="Director's Flight Path">
        <div className="sx-flight-head">
          <h2><Icon.Route className="sx-gold" /> Director&apos;s Flight Path</h2>
          <span className="sx-muted">{scenes.length} scenes • {formatClock(total)} total</span>
          <div className="sx-legend">
            <span><i className="sx-dot is-good" /> Good{healthCounts.good ? ` (${healthCounts.good})` : ''}</span>
            <span><Icon.Warning className="sx-warn-ico" /> Warning{healthCounts.warning ? ` (${healthCounts.warning})` : ''}</span>
            <span><i className="sx-dot is-issue" /> Continuity Issue{healthCounts.issue ? ` (${healthCounts.issue})` : ''}</span>
          </div>
          <label className="sx-zoom">
            <span>Zoom</span>
            <input type="range" min="0.6" max="3" step="0.1" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Timeline zoom" />
            <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(3, +(z + 0.4).toFixed(1)))}><Icon.Plus /></button>
          </label>
        </div>

        <div className="sx-flight-scroll">
          <div className="sx-flight-track" style={zoom > 1 ? { minWidth: `${Math.max(100, total * pxPerSecond)}px` } : undefined}>
            <div className="sx-tiles">
              {scenes.map((s) => {
                const h = sceneHealth(s);
                return (
                  <button key={s.id} type="button" className={`sx-tile ${s.id === selectedId ? 'is-active' : ''}`} style={{ flexGrow: s.duration_seconds, flexBasis: 0 }} onClick={() => selectScene(s.id)}>
                    <span className="sx-tile-img">
                      <Thumb scene={s} />
                      {h === 'warning' && <Icon.Warning className="sx-tile-flag is-warning" />}
                      {h === 'issue' && <Icon.Warning className="sx-tile-flag is-issue" />}
                      {h === 'good' && <i className="sx-tile-flag sx-dot is-good" />}
                      {h === 'pending' && <i className="sx-tile-flag sx-dot is-pending" />}
                    </span>
                    <span className="sx-tile-cap">
                      <b>{s.position}</b><strong>{s.title}</strong><span className="sx-tile-dur">{formatClock(s.duration_seconds)}</span>
                    </span>
                    <span className="sx-tile-audio">
                      <Waveform peaks={scenePeaks(s)} progress={s.id === selectedId ? playhead / s.duration_seconds : -1} />
                      <span className="sx-tile-dur">{formatClock(s.duration_seconds)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="sx-health-bar" role="slider" tabIndex={0} aria-label="Timeline position" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(globalTime)}
              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seekGlobal(((e.clientX - r.left) / r.width) * total); }}
              onKeyDown={(e) => { if (e.key === 'ArrowRight') seekGlobal(globalTime + 1); if (e.key === 'ArrowLeft') seekGlobal(globalTime - 1); }}>
              {scenes.map((s) => <span key={s.id} className={`sx-health is-${sceneHealth(s)}`} style={{ flexGrow: s.duration_seconds }} />)}
              <span className="sx-playhead" style={{ left: `${total ? (globalTime / total) * 100 : 0}%` }} />
            </div>
            <div className="sx-ruler">
              {offsets.map((o) => <span key={o.id} style={{ left: `${total ? (o.start / total) * 100 : 0}%` }}>{formatClock(o.start)}</span>)}
              <span className="is-end">{formatClock(total)}</span>
            </div>
          </div>
        </div>
      </section>

      {audioAsset && <audio ref={audioRef} src={audioAsset.preview_url} preload="auto" hidden />}

      {/* ------------------------------------------------ confirm dialog */}
      {genDialog && (
        <div className="sx-backdrop" role="presentation" onClick={() => setGenDialog(null)}>
          <section className="sx-dialog" role="dialog" aria-modal="true" aria-labelledby="sx-gen-title" onClick={(e) => e.stopPropagation()}>
            <p className="sx-kicker">Final confirmation</p>
            <h2 id="sx-gen-title">Start paid generation?</h2>
            <div className="sx-scope" role="radiogroup" aria-label="What to generate">
              <button type="button" role="radio" aria-checked={genDialog.scope === 'scene'} className={genDialog.scope === 'scene' ? 'is-active' : ''} onClick={() => setGenDialog((d) => ({ ...d, scope: 'scene' }))}>
                <strong>This scene</strong><span>{scene?.title} · {genDialog.total} credits</span>
              </button>
              <button type="button" role="radio" aria-checked={genDialog.scope === 'all'} className={genDialog.scope === 'all' ? 'is-active' : ''} onClick={() => setGenDialog((d) => ({ ...d, scope: 'all' }))}>
                <strong>All {scenes.length} scenes</strong><span>{genDialog.all.total} credits</span>
              </button>
            </div>
            <dl className="sx-dl">
              <div><dt>Maximum debit</dt><dd>{genDialog.scope === 'all' ? genDialog.all.total : genDialog.total} credits</dd></div>
              <div><dt>Your balance</dt><dd>{credits ?? '—'} credits</dd></div>
              <div><dt>Model</dt><dd>{videoOption?.label}</dd></div>
            </dl>
            <p className="sx-hint">Credits are reserved first and settled on completion. Failed scenes are refunded automatically.</p>
            <div className="sx-dialog-actions">
              <button type="button" className="sx-btn" autoFocus onClick={() => setGenDialog(null)}>Cancel</button>
              <button type="button" className="sx-btn sx-btn-gold" onClick={confirmGenerate}><Icon.Spark /> Start generation</button>
            </div>
          </section>
        </div>
      )}

      {toast && <div className="sx-toast" role="status" aria-live="polite">{toast}</div>}
    </main>
  );
}
