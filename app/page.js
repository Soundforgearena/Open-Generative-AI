'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AuthScreen from '@/components/cinex/AuthScreen';
import AdminCockpit from '@/components/cinex/AdminCockpit';
import RevenuePanel from '@/components/cinex/RevenuePanel';
import {
  confirmExport,
  createProject,
  getAccount,
  getCatalog,
  getProject,
  getStoredSession,
  listProjects,
  quoteExport,
  requestDirectorPlan,
  signOut,
  startGeneration,
  updateScene,
  uploadReference,
  waitForJob,
} from '@/lib/cinexvideo-client';

const LANES = [
  { id: 'music_video', label: 'Music Videos' },
  { id: 'episode', label: 'Episodes' },
];

const STATUS_DOT = {
  approved: 'green',
  needs_review: 'orange',
  generating: 'orange',
  failed: 'gray',
  draft: 'gray',
};

export default function Home() {
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [lane, setLane] = useState('episode');
  const [view, setView] = useState('storyboard');

  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [detail, setDetail] = useState(null);

  const [selectedSceneId, setSelectedSceneId] = useState(null);
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const [exportQuote, setExportQuote] = useState(null);

  const notify = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 4000);
  }, []);

  /* ----------------------------------------------------------- bootstrap */

  const loadAccount = useCallback(async () => {
    const data = await getAccount();
    setAccount(data);
    return data;
  }, []);

  const loadProjects = useCallback(async () => {
    const data = await listProjects();
    setProjects(data.projects || []);
    return data.projects || [];
  }, []);

  const loadProject = useCallback(async (id) => {
    if (!id) {
      setDetail(null);
      return;
    }
    const data = await getProject(id);
    setDetail(data);
    setSelectedSceneId((current) => {
      const stillThere = data.scenes.some((scene) => scene.id === current);
      return stillThere ? current : data.scenes[0]?.id || null;
    });
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      await loadAccount();
      const [loaded, catalogData] = await Promise.all([loadProjects(), getCatalog()]);
      setCatalog(catalogData.options || []);
      if (loaded.length) {
        setLane(loaded[0].lane);
        setProjectId(loaded[0].id);
      }
    } catch (err) {
      if (/sign in|Authentication/i.test(err.message)) {
        signOut();
        setAccount(null);
      } else {
        notify(err.message);
      }
    } finally {
      setReady(true);
    }
  }, [loadAccount, loadProjects, notify]);

  useEffect(() => {
    if (getStoredSession()) bootstrap();
    else setReady(true);
  }, [bootstrap]);

  useEffect(() => {
    loadProject(projectId).catch((err) => notify(err.message));
  }, [projectId, loadProject, notify]);

  /* -------------------------------------------------------------- derived */

  const scenes = detail?.scenes || [];
  const scene = scenes.find((item) => item.id === selectedSceneId) || null;
  const totalDuration = useMemo(
    () => scenes.reduce((sum, item) => sum + Number(item.duration_seconds || 0), 0),
    [scenes]
  );
  const laneProjects = projects.filter((project) => project.lane === lane);
  const videoOption = catalog.find((option) => option.operation === 'video') || catalog[0] || null;

  const activeTake = scene
    ? scene.versions?.find((version) => version.version === scene.active_version) || null
    : null;
  const pendingTake = scene
    ? scene.versions?.find((version) => version.status === 'completed' && !version.approved) || null
    : null;

  /* --------------------------------------------------------------- actions */

  async function runDirector() {
    if (!brief.trim()) {
      notify('Describe your idea first.');
      return;
    }
    setBusy('director');
    try {
      const plan = await requestDirectorPlan(brief.trim(), lane);
      const created = await createProject({ lane, plan });
      await loadProjects();
      setProjectId(created.project_id);
      setBrief('');
      notify(`"${plan.creative_title}" is ready — ${plan.scenes.length} scenes planned.`);
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy('');
    }
  }

  async function generateScene() {
    if (!scene) return;
    if (!videoOption) {
      notify('No creative options are available right now.');
      return;
    }
    setBusy('generate');
    try {
      const started = await startGeneration({
        model: videoOption.model,
        operation: videoOption.operation,
        project_id: projectId,
        scene_id: scene.id,
        duration_seconds: scene.duration_seconds,
        reference_count: detail?.assets?.length || 0,
        input: {
          prompt: [scene.prompt, scene.shot_direction].filter(Boolean).join('\n\n'),
          duration: scene.duration_seconds,
        },
      });
      notify(`New take queued · ${started.credits_required} credits reserved.`);
      await loadProject(projectId);

      const result = await waitForJob(started.request_id, {
        onTick: (tick) => setBusy(tick.status === 'running' ? 'generate' : ''),
      });

      if (result.status === 'completed') notify('Take ready for your review.');
      else notify(`Take failed — ${result.credits_returned ?? 0} credits returned.`);

      await Promise.all([loadProject(projectId), loadAccount()]);
    } catch (err) {
      notify(err.message);
      await loadProject(projectId).catch(() => {});
    } finally {
      setBusy('');
    }
  }

  async function patchScene(patch, message) {
    if (!scene) return;
    try {
      await updateScene(scene.id, patch);
      await loadProject(projectId);
      if (message) notify(message);
    } catch (err) {
      notify(err.message);
    }
  }

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !projectId) return;
    setBusy('upload');
    try {
      await uploadReference(projectId, file, { kind: 'reference' });
      await loadProject(projectId);
      notify('Reference added to the project library.');
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy('');
    }
  }

  async function askExportQuote(exportType) {
    if (!projectId) return;
    setBusy('export');
    try {
      setExportQuote(await quoteExport({ project_id: projectId, export_type: exportType }));
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy('');
    }
  }

  async function commitExport() {
    if (!exportQuote) return;
    setBusy('export');
    try {
      const result = await confirmExport({
        project_id: projectId,
        export_type: exportQuote.export_type,
      });
      notify(
        result.credits_charged
          ? `Export queued · ${result.credits_charged} credits used.`
          : 'Watermarked export queued.'
      );
      setExportQuote(null);
      await Promise.all([loadAccount(), loadProject(projectId)]);
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy('');
    }
  }

  /* ----------------------------------------------------------------- views */

  if (!ready) return <main className="app-shell"><p>Loading CinexVideo…</p></main>;
  if (!account) return <AuthScreen onSignedIn={bootstrap} />;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">C</span>
          <span>CINEXVIDEO</span>
        </div>
        <div className="top-status">
          <span className={`status-dot ${account.maintenance ? 'orange' : 'green'}`} />{' '}
          {account.maintenance ? 'MAINTENANCE' : 'SYSTEM LIVE'}
          <span className="divider" />
          {account.credits} CREDITS
          {account.promotion_active && (
            <>
              <span className="divider" />
              PROMOTION ACTIVE
            </>
          )}
        </div>
        <button
          className="icon-button"
          onClick={() => {
            signOut();
            setAccount(null);
            setDetail(null);
            setProjects([]);
          }}
        >
          Sign out
        </button>
      </header>

      {account.maintenance && !account.is_admin && (
        <div className="banner">
          CinexVideo is in maintenance. New generations are paused — your projects are safe.
        </div>
      )}

      <nav className="tabs">
        {LANES.map((item) => (
          <button
            key={item.id}
            className={lane === item.id ? 'tab active' : 'tab'}
            onClick={() => {
              setLane(item.id);
              const next = projects.find((project) => project.lane === item.id);
              setProjectId(next?.id || null);
              setView('storyboard');
            }}
          >
            {item.label}
          </button>
        ))}
        <span className="tab-separator" />
        <button
          className={view === 'storyboard' ? 'tab active' : 'tab'}
          onClick={() => setView('storyboard')}
        >
          Storyboard
        </button>
        {account.is_admin && (
          <button className={view === 'admin' ? 'tab active' : 'tab'} onClick={() => setView('admin')}>
            Admin Cockpit
          </button>
        )}
        {account.is_super_admin && (
          <button className={view === 'revenue' ? 'tab active' : 'tab'} onClick={() => setView('revenue')}>
            Revenue &amp; Payouts
          </button>
        )}
      </nav>

      {view === 'revenue' && account.is_super_admin ? (
        <RevenuePanel notify={notify} />
      ) : view === 'admin' && account.is_admin ? (
        <AdminCockpit notify={notify} />
      ) : (
        <>
          <section className="hero-row">
            <div>
              <div className="eyebrow">AI DIRECTOR / {lane === 'episode' ? 'EPISODES' : 'MUSIC VIDEOS'}</div>
              <h1>{lane === 'episode' ? 'Build worlds. Direct every frame.' : 'Turn sound into moving cinema.'}</h1>
              <p>
                Describe the idea. The AI Director returns a treatment, cast, locations and a
                shot-by-shot storyboard you can generate and refine.
              </p>
              <textarea
                value={brief}
                placeholder={
                  lane === 'episode'
                    ? 'A radio host starts receiving broadcasts from a station that was demolished ten years ago…'
                    : 'A neon-lit rooftop performance that dissolves into a rain-soaked chase…'
                }
                onChange={(event) => setBrief(event.target.value)}
              />
              <div className="hero-actions">
                <button className="primary" onClick={runDirector} disabled={busy === 'director'}>
                  {busy === 'director' ? 'Directing…' : 'Generate with AI Director'} <span>→</span>
                </button>
              </div>
            </div>

            <div className="project-picker panel">
              <span className="eyebrow">YOUR PROJECTS</span>
              {laneProjects.length ? (
                <div className="scene-list">
                  {laneProjects.map((project) => (
                    <button
                      key={project.id}
                      className={projectId === project.id ? 'scene-row selected' : 'scene-row'}
                      onClick={() => setProjectId(project.id)}
                    >
                      <span className="scene-copy">
                        <strong>{project.title}</strong>
                        <small>{project.status.replace('_', ' ')}</small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p>No projects in this lane yet. Describe an idea to start one.</p>
              )}
            </div>
          </section>

          {!detail ? (
            <section className="panel">
              <p>Select a project, or use the AI Director to create your first one.</p>
            </section>
          ) : (
            <>
              <section className="workspace-grid">
                <aside className="panel scenes-panel">
                  <div className="panel-heading">
                    <span className="eyebrow">{detail.project.title.toUpperCase()}</span>
                  </div>
                  <h2>{detail.project.logline || 'No logline yet'}</h2>
                  <div className="meta-line">
                    {scenes.length} scenes <span>•</span> {totalDuration}s planned
                  </div>
                  <div className="scene-list">
                    {scenes.map((item) => (
                      <button
                        key={item.id}
                        className={selectedSceneId === item.id ? 'scene-row selected' : 'scene-row'}
                        onClick={() => setSelectedSceneId(item.id)}
                      >
                        <span className="scene-number">
                          {String(item.position).padStart(2, '0')}
                        </span>
                        <span className="scene-copy">
                          <strong>{item.title}</strong>
                          <small>
                            {item.purpose || '—'} / {item.duration_seconds}s
                          </small>
                        </span>
                        <span className={`status-dot ${STATUS_DOT[item.status] || 'gray'}`} />
                      </button>
                    ))}
                  </div>
                </aside>

                <section className="preview-column">
                  <div
                    className="preview-frame"
                    style={
                      activeTake?.output_url
                        ? {
                            backgroundImage: `linear-gradient(135deg, rgba(10,10,10,.18), rgba(10,10,10,.8)), url(${activeTake.output_url})`,
                          }
                        : undefined
                    }
                  >
                    <div className="preview-top">
                      <span className="eyebrow">STORYBOARD CINEMA MODE</span>
                      <span className="preview-watermark">
                        CINEXVIDEO PREVIEW · {account.user.email}
                      </span>
                    </div>
                    <div className="preview-center">
                      {activeTake?.output_url ? (
                        <video src={activeTake.output_url} controls className="preview-video" />
                      ) : (
                        <span>
                          {scene
                            ? scene.status === 'generating'
                              ? 'Generating take…'
                              : 'No take generated yet'
                            : 'Select a scene'}
                        </span>
                      )}
                    </div>
                    <div className="preview-bottom">
                      <span>{scene ? `${scene.duration_seconds}.00s` : '—'}</span>
                      <span>VERSION {scene?.active_version ?? 1}</span>
                      <span>16:9 / CINEMATIC</span>
                    </div>
                  </div>

                  {pendingTake && (
                    <div className="panel review-panel">
                      <div>
                        <span className="eyebrow">NEW TAKE · VERSION {pendingTake.version}</span>
                        <p>
                          Your current approved take is untouched until you accept this one.
                        </p>
                      </div>
                      <div className="export-actions">
                        {pendingTake.output_url && (
                          <a className="secondary" href={pendingTake.output_url} target="_blank" rel="noreferrer">
                            Watch take
                          </a>
                        )}
                        <button
                          className="primary"
                          onClick={() =>
                            patchScene({ approve_version: pendingTake.version }, 'Take approved.')
                          }
                        >
                          Approve take
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="timeline">
                    <div className="timeline-head">
                      <span className="eyebrow">TIMELINE</span>
                      <span>{totalDuration}.00s</span>
                    </div>
                    <div className="timeline-track">
                      {scenes.map((item) => (
                        <button
                          key={item.id}
                          className={selectedSceneId === item.id ? 'clip selected' : 'clip'}
                          style={{ flex: item.duration_seconds }}
                          onClick={() => setSelectedSceneId(item.id)}
                        >
                          <span>{String(item.position).padStart(2, '0')}</span>
                          <small>{item.title}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                </section>

                <aside className="right-column">
                  <div className="panel director-panel">
                    <div className="panel-heading">
                      <span className="eyebrow">SCENE DIRECTION</span>
                    </div>
                    {scene ? (
                      <>
                        <h2>{scene.title}</h2>
                        <textarea
                          value={scene.prompt || ''}
                          onChange={(event) =>
                            setDetail({
                              ...detail,
                              scenes: scenes.map((item) =>
                                item.id === scene.id ? { ...item, prompt: event.target.value } : item
                              ),
                            })
                          }
                        />
                        <div className="director-controls">
                          <label>
                            Duration
                            <input
                              type="number"
                              min="1"
                              max="600"
                              value={scene.duration_seconds}
                              onChange={(event) =>
                                setDetail({
                                  ...detail,
                                  scenes: scenes.map((item) =>
                                    item.id === scene.id
                                      ? { ...item, duration_seconds: Number(event.target.value) }
                                      : item
                                  ),
                                })
                              }
                            />
                          </label>
                          <label>
                            Continuity lock
                            <button
                              className={scene.continuity_locked ? 'control active-control' : 'control'}
                              onClick={() =>
                                patchScene(
                                  { continuity_locked: !scene.continuity_locked },
                                  scene.continuity_locked ? 'Continuity unlocked' : 'Continuity locked'
                                )
                              }
                            >
                              {scene.continuity_locked ? 'ON' : 'OFF'}
                            </button>
                          </label>
                        </div>
                        <button
                          className="secondary full"
                          onClick={() =>
                            patchScene(
                              { prompt: scene.prompt, duration_seconds: scene.duration_seconds },
                              'Scene saved.'
                            )
                          }
                        >
                          Save direction
                        </button>
                        <button
                          className="primary full"
                          onClick={generateScene}
                          disabled={busy === 'generate' || account.maintenance}
                        >
                          {busy === 'generate'
                            ? 'Generating…'
                            : scene.versions?.length
                              ? 'Generate new take'
                              : 'Generate scene'}
                        </button>
                      </>
                    ) : (
                      <p>Select a scene to direct it.</p>
                    )}
                  </div>

                  <div className="panel references-panel">
                    <div className="panel-heading">
                      <span className="eyebrow">CAST / OUTFITS / LOCATIONS</span>
                    </div>
                    <div className="reference-grid">
                      {detail.assets.slice(0, 9).map((asset) => (
                        <div key={asset.id} className="reference-card">
                          <div
                            className="reference-image"
                            style={
                              asset.preview_url
                                ? { backgroundImage: `url(${asset.preview_url})`, backgroundSize: 'cover' }
                                : undefined
                            }
                          >
                            {asset.preview_url ? '' : asset.name.slice(0, 18).toUpperCase()}
                          </div>
                          <small>{asset.kind}</small>
                        </div>
                      ))}
                    </div>
                    {!detail.assets.length && <p>No references yet.</p>}
                    <label className="upload-button">
                      {busy === 'upload' ? 'Uploading…' : '+ Upload reference'}
                      <input type="file" accept="image/*,audio/*" onChange={handleUpload} />
                    </label>
                  </div>
                </aside>
              </section>

              <section className="bottom-grid">
                <div className="panel status-panel">
                  <div className="panel-heading">
                    <span className="eyebrow">PRODUCTION STATUS</span>
                  </div>
                  <div className="status-items">
                    <span>● {scenes.filter((item) => item.status === 'approved').length} scenes approved</span>
                    <span>● {scenes.filter((item) => item.status === 'needs_review').length} awaiting review</span>
                    <span>● {detail.assets.length} references locked in</span>
                    <span>● {account.credits} credits available</span>
                  </div>
                </div>

                <div className="panel export-panel">
                  <div>
                    <span className="eyebrow">EXPORT</span>
                    <h2>Choose your finish</h2>
                    <p>
                      Watermarked delivery is included with your generation. Remove the watermark
                      when you are ready for final delivery.
                    </p>
                    {exportQuote && (
                      <p className="quote-line">
                        {exportQuote.export_type.replace('_', ' ')} ·{' '}
                        {exportQuote.credits_required
                          ? `${exportQuote.credits_required} credits`
                          : 'included'}
                        {' — '}
                        <button className="small-action" onClick={commitExport} disabled={busy === 'export'}>
                          Confirm
                        </button>
                        <button className="small-action" onClick={() => setExportQuote(null)}>
                          Cancel
                        </button>
                      </p>
                    )}
                  </div>
                  <div className="export-actions">
                    <button
                      className="secondary"
                      onClick={() => askExportQuote('watermarked')}
                      disabled={busy === 'export'}
                    >
                      Export with watermark <small>Included</small>
                    </button>
                    <button
                      className="primary"
                      onClick={() => askExportQuote('clean')}
                      disabled={busy === 'export'}
                    >
                      Remove watermark <small>Credits required</small>
                    </button>
                    <button
                      className="secondary"
                      onClick={() => askExportQuote('storyboard')}
                      disabled={busy === 'export'}
                    >
                      Storyboard pack <small>Credits required</small>
                    </button>
                  </div>
                </div>
              </section>
            </>
          )}
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
