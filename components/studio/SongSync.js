'use client';

// Song Sync: lyrics -> exact line timing -> scenes cut to the song.
// Lives in the Studio inspector. Timing is charged in purchased credits and
// always quoted first; reviewing, editing and building scenes are free.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildScenesFromSong,
  getMusicSync,
  saveLyrics,
  saveLyricTiming,
  timeLyrics,
} from '@/lib/cinexvideo-client';

function clock(ms) {
  const t = Math.max(0, Number(ms) || 0) / 1000;
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}

function songDuration(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(0); return; }
    const a = new Audio();
    a.preload = 'metadata';
    a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : 0);
    a.onerror = () => resolve(0);
    a.src = url;
  });
}

const TIMING_STALE_MS = 20 * 60 * 1000;
const POLL_MS = 5000;
const isTimingRunning = (m) => m?.timing?.status === 'running' && Date.now() - Date.parse(m.timing.started_at || 0) < TIMING_STALE_MS;

const isSinger = (c) => (c?.role || 'singer') === 'singer';

function castSummary(cast) {
  if (!cast?.length) return '';
  const names = (list) => list.map((c) => c.label).join(' and ');
  const singers = cast.filter(isSinger);
  const backing = cast.filter((c) => !isSinger(c));
  return ` · ${singers.length} ${singers.length === 1 ? 'singer' : 'singers'} (${names(singers)})${backing.length ? ` · backing chant: ${names(backing)}` : ''}`;
}

export default function SongSync({ project, audioAsset, demo = false, onRefresh, onToast, onCharged, onUpload, faces = [] }) {
  const music = project?.music || null;
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState('');
  const [lyricsDraft, setLyricsDraft] = useState('');
  const [review, setReview] = useState(null); // { lines, cast }
  const [confirmTime, setConfirmTime] = useState(false);
  const [confirmBuild, setConfirmBuild] = useState(false);
  const [resolution, setResolution] = useState('1080p');
  const [listening, setListening] = useState(false);
  const player = useRef(null);
  const stopAt = useRef(0);
  const polling = useRef(false);

  const step = !audioAsset ? 'song' : !project?.has_lyrics ? 'lyrics' : !music?.lines?.length ? 'time' : !music.confirmed ? 'review' : !music.built_at ? 'build' : 'done';

  useEffect(() => {
    let live = true;
    if (demo || !project?.id || !audioAsset) return undefined;
    (async () => {
      const ms = music?.duration_ms || (await songDuration(audioAsset.preview_url));
      try {
        const data = await getMusicSync(project.id, ms);
        if (live) setInfo({ ...data, duration_ms: ms });
      } catch { /* panel still works without the quote */ }
    })();
    return () => { live = false; };
  }, [demo, project?.id, audioAsset?.id, music?.duration_ms, music?.timed_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const lowConfidence = useMemo(() => (music?.lines || []).filter((l) => l.confidence < 0.5).length, [music]);

  async function run(label, fn) {
    if (busy) return;
    setBusy(label);
    try { await fn(); } catch (error) { onToast?.(error.message || 'That did not work. Please try again.'); } finally { setBusy(''); }
  }

  const submitLyrics = () => run('lyrics', async () => {
    if (!lyricsDraft.trim()) { onToast?.('Paste your lyrics first.'); return; }
    await saveLyrics(project.id, lyricsDraft);
    onToast?.('Lyrics saved. Next, time them to your song.');
    await onRefresh?.();
  });

  // Listening runs on the server in the background; wait for it here.
  async function waitForTiming() {
    if (polling.current) return;
    polling.current = true;
    setListening(true);
    try {
      const until = Date.now() + TIMING_STALE_MS;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        let data;
        try { data = await getMusicSync(project.id); } catch { continue; }
        const m = data?.music;
        if (isTimingRunning(m)) continue;
        await onRefresh?.();
        if (m?.timing?.status === 'done') {
          onCharged?.(m.timing.credits || 0);
          const flagged = (m.lines || []).filter((l) => l.confidence < 0.5).length;
          onToast?.(`Every line is timed (${m.timing.credits || 0} credits).${flagged ? ` ${flagged} line${flagged > 1 ? 's' : ''} to check.` : ''} Review the timing before building scenes.`);
          openReview(m);
        } else if (m?.timing?.status === 'failed') {
          onToast?.(m.timing.message || 'Your song could not be timed right now. You were not charged.');
        }
        return;
      }
      onToast?.('Timing is taking longer than expected. Refresh the page in a few minutes.');
    } finally {
      polling.current = false;
      setListening(false);
    }
  }

  useEffect(() => {
    if (!demo && project?.id && isTimingRunning(music)) waitForTiming();
  }, [demo, project?.id, music?.timing?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const startTiming = () => run('time', async () => {
    setConfirmTime(false);
    await timeLyrics(project.id, info?.timing_credits);
    waitForTiming();
  });

  const timingBusy = listening || busy === 'time' || isTimingRunning(music);

  function timingControl(again) {
    if (timingBusy) {
      return (
        <p className="sx-hint" role="status" aria-live="polite">
          Listening to your song and timing every line. This takes about 2 to 4 minutes; you can keep working.
        </p>
      );
    }
    if (!confirmTime) {
      return (
        <button type="button" className={`sx-btn ${again ? 'sx-btn-ghost' : 'sx-btn-gold'}`} onClick={() => setConfirmTime(true)} disabled={!info?.timing_credits || Boolean(busy)}>
          {info?.timing_credits ? `${again ? 'Time again' : 'Time my lyrics'} · ${info.timing_credits} credits` : 'Pricing...'}
        </button>
      );
    }
    return (
      <div className="sx-readiness" role="group" aria-label="Confirm lyric timing">
        <strong>{again ? 'Time your song again' : 'Time your lyrics'} for {info.timing_credits} credits (${(info.timing_credits / 100).toFixed(2)})?</strong>
        <span>{again ? 'This replaces the current timing and any line edits. ' : ''}Paid with purchased credits. If timing fails you are not charged.</span>
        <div className="sx-dialog-actions">
          <button type="button" className="sx-btn" onClick={() => setConfirmTime(false)}>Cancel</button>
          <button type="button" className="sx-btn sx-btn-gold" onClick={startTiming} disabled={Boolean(busy)}>Confirm</button>
        </div>
      </div>
    );
  }

  function openReview(m = music) {
    if (!m?.lines) return;
    setReview({ lines: m.lines.map((l) => ({ ...l })), cast: (m.cast || []).map((c) => ({ ...c })) });
  }

  function playLine(line) {
    const el = player.current;
    if (!el) return;
    el.currentTime = Math.max(0, line.start_ms / 1000 - 0.05);
    stopAt.current = line.end_ms / 1000 + 0.1;
    el.play().catch(() => {});
  }

  function patchLine(i, patch) {
    setReview((r) => ({ ...r, lines: r.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) }));
  }

  const saveReview = (confirmed) => run('save', async () => {
    await saveLyricTiming(project.id, { lines: review.lines.map(({ start_ms, end_ms, vocalist }) => ({ start_ms, end_ms, vocalist })), cast: review.cast, confirmed });
    if (confirmed) setReview(null);
    onToast?.(confirmed ? 'Timing confirmed. Build your scenes from the song.' : 'Timing saved.');
    await onRefresh?.();
  });

  const build = (replaceTakes) => run('build', async () => {
    try {
      const r = await buildScenesFromSong(project.id, { replaceTakes, resolution });
      setConfirmBuild(false);
      onToast?.(`${r.scenes} scenes built from your song. ${r.lip_sync_scenes} are lip-synced to the vocals.`);
      await onRefresh?.();
    } catch (error) {
      if (error.data?.code === 'has_takes') { setConfirmBuild(true); return; }
      throw error;
    }
  });

  if (demo) return <p className="sx-hint">Song Sync is available when you are signed in.</p>;

  return (
    <div className="sx-sync">
      <ol className="sx-sync-steps" aria-label="Song sync progress">
        {[['song', 'Song'], ['lyrics', 'Lyrics'], ['time', 'Timing'], ['review', 'Review'], ['build', 'Scenes']].map(([key, label], i, all) => {
          const order = ['song', 'lyrics', 'time', 'review', 'build', 'done'];
          const state = order.indexOf(step) > i ? 'is-done' : step === key ? 'is-now' : '';
          return <li key={key} className={state}><span>{order.indexOf(step) > i ? '✓' : i + 1}</span>{label}{i < all.length - 1 && <i aria-hidden="true" />}</li>;
        })}
      </ol>

      {step === 'song' && (
        <>
          <p className="sx-hint">Upload your finished song. Every scene will be cut to it, and sung lines are lip-synced to the vocals.</p>
          <button type="button" className="sx-btn sx-btn-gold" onClick={onUpload}>Upload your song</button>
        </>
      )}

      {step === 'lyrics' && (
        <>
          <p className="sx-hint">Paste the lyrics. Put the singer in brackets above their lines, for example [Afro-Canadian], [Jamaican], [Ladies] or [Both].</p>
          <textarea className="sx-inline-input sx-sync-lyrics" rows={6} value={lyricsDraft} onChange={(e) => setLyricsDraft(e.target.value)} placeholder={'[Lead]\nFirst line of the song\nSecond line'} maxLength={20000} aria-label="Song lyrics" />
          <button type="button" className="sx-btn sx-btn-gold" onClick={submitLyrics} disabled={busy === 'lyrics'}>{busy === 'lyrics' ? 'Saving...' : 'Save lyrics'}</button>
        </>
      )}

      {step === 'time' && (
        <>
          <p className="sx-hint">{info?.parsed_lines || 0} lines found{castSummary(info?.cast)}. CineXVideo listens to your song and finds exactly when each line is sung.</p>
          {timingControl(false)}
        </>
      )}

      {(step === 'review' || step === 'build' || step === 'done') && (
        <>
          <p className="sx-hint">
            {music.lines.length} lines timed · song {clock(music.duration_ms)}
            {lowConfidence ? ` · ${lowConfidence} line${lowConfidence > 1 ? 's' : ''} to check` : ' · all lines matched'}
            {music.built_at ? ` · ${music.scene_count} scenes built` : ''}
          </p>
          {step !== 'review' && (
            <label className="sx-field" htmlFor="sx-sync-res">
              <span className="sx-field-label">Picture quality</span>
              <span className="sx-select-wrap">
                <select id="sx-sync-res" value={resolution} onChange={(e) => setResolution(e.target.value)}>
                  <option value="720p">720p HD · lower cost</option>
                  <option value="1080p">1080p Full HD · most lifelike</option>
                </select>
              </span>
            </label>
          )}
          <div className="sx-sync-actions">
            <button type="button" className={`sx-btn ${step === 'review' ? 'sx-btn-gold' : 'sx-btn-ghost'}`} onClick={() => openReview()}>Review timing</button>
            {step !== 'review' && (
              <button type="button" className={`sx-btn ${step === 'build' ? 'sx-btn-gold' : 'sx-btn-ghost'}`} onClick={() => build(false)} disabled={busy === 'build' || timingBusy}>
                {busy === 'build' ? 'Building...' : music.built_at ? 'Rebuild scenes' : 'Build scenes from song'}
              </button>
            )}
          </div>
          {timingControl(true)}
          {confirmBuild && (
            <div className="sx-readiness is-blocked" role="alertdialog" aria-label="Replace scenes">
              <strong>Replace every scene?</strong>
              <span>Some scenes already have takes. Rebuilding removes all scenes and their takes. Credits already spent are not refunded.</span>
              <div className="sx-dialog-actions">
                <button type="button" className="sx-btn" onClick={() => setConfirmBuild(false)}>Keep my scenes</button>
                <button type="button" className="sx-btn sx-btn-danger" onClick={() => build(true)}>Replace scenes</button>
              </div>
            </div>
          )}
        </>
      )}

      {review && (
        <div className="sx-backdrop" role="presentation" onClick={() => setReview(null)}>
          <section className="sx-dialog sx-sync-dialog" role="dialog" aria-modal="true" aria-labelledby="sx-sync-title" onClick={(e) => e.stopPropagation()}>
            <p className="sx-kicker">Song Sync</p>
            <h2 id="sx-sync-title">Check every line lands on the vocal</h2>
            <p className="sx-hint">Press play on a line to hear it. Nudge the start or end until it matches the singing exactly. Lip sync uses these times, so accuracy here is accuracy on screen.</p>
            {audioAsset && <audio ref={player} src={audioAsset.preview_url} preload="auto" onTimeUpdate={(e) => { if (stopAt.current && e.currentTarget.currentTime >= stopAt.current) { e.currentTarget.pause(); stopAt.current = 0; } }} hidden />}

            <div className="sx-cast">
              <p className="sx-menu-heading">Who sings · {review.cast.filter(isSinger).length} {review.cast.filter(isSinger).length === 1 ? 'singer' : 'singers'}</p>
              {review.cast.map((c, i) => (
                <div key={c.key} className="sx-cast-row">
                  <span>{c.label}</span>
                  <input className="sx-inline-input" value={c.description || ''} maxLength={400} aria-label={`Describe ${c.label}`}
                    placeholder={isSinger(c) ? 'Describe how this singer looks' : 'Describe who is heard (shown at a distance, not lip-synced)'}
                    onChange={(e) => setReview((r) => ({ ...r, cast: r.cast.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)) }))} />
                  {isSinger(c) && (
                    <span className="sx-select-wrap">
                      <select value={c.face_asset_id || ''} aria-label={`Real face for ${c.label}`}
                        onChange={(e) => setReview((r) => ({ ...r, cast: r.cast.map((x, k) => (k === i ? { ...x, face_asset_id: e.target.value || null } : x)) }))}>
                        <option value="">{faces.length ? 'Choose their face' : 'Add faces in Cast Faces'}</option>
                        {faces.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    </span>
                  )}
                  <span className="sx-select-wrap">
                    <select value={c.role || 'singer'} aria-label={`Role of ${c.label}`}
                      onChange={(e) => setReview((r) => ({ ...r, cast: r.cast.map((x, k) => (k === i ? { ...x, role: e.target.value } : x)) }))}>
                      <option value="singer">Singer on camera</option>
                      <option value="backing">Backing vocal</option>
                    </select>
                  </span>
                </div>
              ))}
            </div>

            <ol className="sx-lines">
              {review.lines.map((l, i) => (
                <li key={l.index ?? i} className={l.confidence < 0.5 ? 'is-check' : ''}>
                  <button type="button" className="sx-line-play" aria-label={`Play line ${i + 1}`} onClick={() => playLine(l)}>▶</button>
                  <div className="sx-line-main">
                    <span className="sx-line-text">{l.text}</span>
                    <span className="sx-line-meta">
                      <select value={l.vocalist || ''} onChange={(e) => patchLine(i, { vocalist: e.target.value })} aria-label={`Singer for line ${i + 1}`}>
                        {review.cast.filter(isSinger).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                        {review.cast.filter(isSinger).length > 1 && <option value="both">Both singers</option>}
                        {review.cast.filter((c) => !isSinger(c)).map((c) => <option key={c.key} value={c.key}>{c.label} (backing, no lip sync)</option>)}
                      </select>
                      {l.confidence < 0.5 && <em>Check timing</em>}
                    </span>
                  </div>
                  <div className="sx-line-times">
                    {['start_ms', 'end_ms'].map((field) => (
                      <span key={field} className="sx-line-time">
                        <button type="button" aria-label={`${field === 'start_ms' ? 'Start' : 'End'} 0.1 seconds earlier`} onClick={() => patchLine(i, { [field]: Math.max(0, l[field] - 100) })}>−</button>
                        <span>{clock(l[field])}</span>
                        <button type="button" aria-label={`${field === 'start_ms' ? 'Start' : 'End'} 0.1 seconds later`} onClick={() => patchLine(i, { [field]: Math.min(music.duration_ms, l[field] + 100) })}>+</button>
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
            <div className="sx-dialog-actions">
              <button type="button" className="sx-btn" onClick={() => saveReview(false)} disabled={Boolean(busy)}>Save for later</button>
              <button type="button" className="sx-btn sx-btn-gold" onClick={() => saveReview(true)} disabled={Boolean(busy)}>{busy === 'save' ? 'Saving...' : 'Timing is right'}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
