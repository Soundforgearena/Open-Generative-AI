'use client';

import { useRef, useState } from 'react';
import { uploadReference } from '../../lib/cinexvideo-client';

export const DANCE_TYPES = 'video/mp4,video/quicktime';
const CONSENT = 'I filmed this clip or have permission from everyone in it.';
export const isDanceClip = (a) => a?.kind === 'motion' && Boolean(a.storage_path || a.preview_url) && a.likeness_consent === true;

/**
 * Dance shots: copy real moves from a short clip onto the scene's approved
 * still. Real moves look human and land on the beat when the dancer was
 * filmed to the song; invented AI dancing warps limbs and drifts.
 */
export default function DancePanel({ project, scene, index, assets, demo, onPatch, onRefresh, onToast }) {
  const input = useRef(null);
  const [draft, setDraft] = useState({ file: null, consent: false });
  const [busy, setBusy] = useState(false);
  const clips = assets.filter(isDanceClip);
  const startSeconds = ((Number(scene?.motion_start_ms) || 0) / 1000);
  const tooShort = scene && Number(scene.duration_seconds) < 3;

  async function add() {
    if (demo) { onToast('Demo mode: uploads are disabled.'); return; }
    if (!draft.file) { onToast('Choose an MP4 or MOV dance clip first.'); return; }
    if (!draft.consent) { onToast('Confirm you filmed this clip or have permission from everyone in it.'); return; }
    setBusy(true);
    try {
      await uploadReference(project.id, draft.file, { kind: 'motion', name: draft.file.name, likenessConsent: true });
      setDraft({ file: null, consent: false });
      if (input.current) input.current.value = '';
      await onRefresh();
      onToast('Dance clip uploaded. Pick it for any scene of 3 seconds or more.');
    } catch (error) {
      onToast(error.message || 'The dance clip could not be uploaded.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sx-dance">
      <p className="sx-hint">Copy real moves from a short clip onto this scene&apos;s approved still. Film the dancer to your song so every move lands on the beat. The price is shown before anything is made.</p>
      {scene && (
        <>
          <label className="sx-field" htmlFor="in-dance">
            <span className="sx-field-label">{`Dance moves in scene ${index + 1}`}</span>
            <span className="sx-select-wrap">
              <select id="in-dance" value={scene.motion_asset_id || ''} disabled={tooShort && !scene.motion_asset_id}
                onChange={(e) => onPatch({ motion_asset_id: e.target.value || null })}>
                <option value="">No dance clip (AI movement)</option>
                {clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </span>
          </label>
          {tooShort && <p className="sx-hint">This scene is under 3 seconds, too short for a dance shot.</p>}
          {scene.motion_asset_id && (
            <label className="sx-field" htmlFor="in-dance-start">
              <span className="sx-field-label">Start the moves at (seconds into the clip)</span>
              <input id="in-dance-start" className="sx-inline-input" type="number" min="0" max="600" step="0.1" inputMode="decimal"
                value={Number.isFinite(startSeconds) ? startSeconds : 0}
                onChange={(e) => onPatch({ motion_start_ms: Math.max(0, Math.round((Number(e.target.value) || 0) * 1000)) })} />
            </label>
          )}
        </>
      )}
      <div className="sx-face-add">
        <p className="sx-menu-heading">Add a dance clip</p>
        <input ref={input} type="file" accept={DANCE_TYPES} aria-label="Dance clip (MP4 or MOV)"
          onChange={(e) => setDraft((d) => ({ ...d, file: e.target.files?.[0] || null }))} />
        <small className="sx-muted">MP4 or MOV · up to 60 MB · one dancer, full body in frame, steady camera works best</small>
        <label className="sx-check">
          <input type="checkbox" checked={draft.consent} onChange={(e) => setDraft((d) => ({ ...d, consent: e.target.checked }))} />
          <span>{CONSENT}</span>
        </label>
        <button type="button" className="sx-btn sx-btn-ghost" disabled={busy} onClick={add}>{busy ? 'Uploading…' : 'Upload dance clip'}</button>
      </div>
    </div>
  );
}
