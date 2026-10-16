'use client';

// Cast faces: the real people in a project. Standard for music videos and
// episodes. Each person gets a clear photo plus a permission confirmation;
// every scene linked to them is generated from their real face.

import { useRef, useState } from 'react';
import { deleteReference, updateReference, uploadReference } from '@/lib/cinexvideo-client';

const PHOTO_TYPES = 'image/jpeg,image/png,image/webp';
const CONSENT = 'I am this person or have their permission to use their face in generated video.';

export const isFace = (a) => a?.kind === 'character' && Boolean(a.storage_path || a.preview_url) && a.likeness_consent === true;

function mentions(scene, name) {
  const n = String(name || '').trim().toLowerCase();
  if (n.length < 2) return false;
  return [scene.title, scene.purpose, scene.prompt, scene.lyric_text].some((t) => String(t || '').toLowerCase().includes(n));
}

export default function FacesPanel({ project, assets = [], scenes = [], demo = false, onRefresh, onToast, onLinkScenes }) {
  const people = assets.filter((a) => a.kind === 'character');
  const [busy, setBusy] = useState('');
  const [draft, setDraft] = useState({ name: '', consent: false, file: null });
  const replaceFor = useRef(null);
  const replaceInput = useRef(null);
  const newInput = useRef(null);

  async function run(label, fn) {
    if (busy) return;
    if (demo) { onToast?.('Demo mode: faces are not saved.'); return; }
    setBusy(label);
    try { await fn(); } catch (error) { onToast?.(error.message || 'That did not work. Please try again.'); } finally { setBusy(''); }
  }

  const addPerson = () => run('add', async () => {
    const name = draft.name.trim();
    if (!name) { onToast?.('Name this person first.'); return; }
    if (!draft.file) { onToast?.('Choose a clear, front-facing photo.'); return; }
    if (!draft.consent) { onToast?.('Confirm you have permission to use this face.'); return; }
    // A named character from the AI Director with no photo yet is replaced.
    const placeholder = people.find((p) => !p.preview_url && p.name?.toLowerCase() === name.toLowerCase());
    await uploadReference(project.id, draft.file, { kind: 'character', name, likenessConsent: true });
    if (placeholder) await deleteReference(placeholder.id).catch(() => {});
    setDraft({ name: '', consent: false, file: null });
    if (newInput.current) newInput.current.value = '';
    onToast?.(`${name} added. Link them to the scenes they appear in.`);
    await onRefresh?.();
  });

  const replacePhoto = (person, file) => run(`photo-${person.id}`, async () => {
    if (!window.confirm(`Use this photo for ${person.name}? ${CONSENT}`)) return;
    const linked = scenes.filter((s) => s.character_asset_id === person.id).map((s) => s.id);
    const fresh = await uploadReference(project.id, file, { kind: 'character', name: person.name, notes: person.notes, likenessConsent: true });
    if (linked.length && fresh?.id) onLinkScenes?.(linked, fresh.id);
    await deleteReference(person.id).catch(() => {});
    onToast?.(`New photo saved for ${person.name}.`);
    await onRefresh?.();
  });

  const setConsent = (person, value) => run(`consent-${person.id}`, async () => {
    await updateReference(person.id, { likeness_consent: value });
    onToast?.(value ? `${person.name}'s face can now be used.` : `${person.name}'s face is no longer used in any scene.`);
    await onRefresh?.();
  });

  return (
    <div className="sx-faces">
      <p className="sx-hint">Add a clear, front-facing, well-lit photo of each real person. Every scene linked to them is made with their real face, then lip-synced when they sing.</p>

      {people.length > 0 && (
        <ul className="sx-face-list">
          {people.map((p) => {
            const linked = scenes.filter((s) => s.character_asset_id === p.id).length;
            const suggested = scenes.filter((s) => !s.character_asset_id && mentions(s, p.name)).map((s) => s.id);
            return (
              <li key={p.id} className="sx-face">
                <span className="sx-face-photo">{p.preview_url ? <img src={p.preview_url} alt={`${p.name}`} referrerPolicy="no-referrer" /> : <span className="sx-face-empty">No photo</span>}</span>
                <div className="sx-face-main">
                  <strong>{p.name}</strong>
                  <span className={`sx-status ${isFace(p) ? 'is-good' : 'is-warning'}`}>
                    {!p.preview_url ? 'Needs a photo' : isFace(p) ? `Real face · ${linked} ${linked === 1 ? 'scene' : 'scenes'}` : 'Needs permission'}
                  </span>
                  {p.preview_url && (
                    <label className="sx-check">
                      <input type="checkbox" checked={p.likeness_consent === true} disabled={Boolean(busy)} onChange={(e) => setConsent(p, e.target.checked)} />
                      <span>{CONSENT}</span>
                    </label>
                  )}
                  <div className="sx-face-actions">
                    <button type="button" className="sx-link-btn" disabled={Boolean(busy)} onClick={() => { replaceFor.current = p; replaceInput.current?.click(); }}>
                      {p.preview_url ? 'Replace photo' : 'Add photo'}
                    </button>
                    {isFace(p) && suggested.length > 0 && (
                      <button type="button" className="sx-link-btn" onClick={() => onLinkScenes?.(suggested, p.id)}>
                        Use in {suggested.length} {suggested.length === 1 ? 'scene' : 'scenes'} that mention {p.name}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <input ref={replaceInput} type="file" accept={PHOTO_TYPES} hidden aria-label="Choose a replacement photo"
        onChange={(e) => { const f = e.target.files?.[0]; const p = replaceFor.current; e.target.value = ''; if (f && p) replacePhoto(p, f); }} />

      <div className="sx-face-add">
        <p className="sx-menu-heading">Add a person</p>
        <input className="sx-inline-input" placeholder="Name, e.g. Jamaican singer" value={draft.name} maxLength={80} aria-label="Person's name"
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        <input ref={newInput} type="file" accept={PHOTO_TYPES} aria-label="Person's photo"
          onChange={(e) => setDraft((d) => ({ ...d, file: e.target.files?.[0] || null }))} />
        <label className="sx-check">
          <input type="checkbox" checked={draft.consent} onChange={(e) => setDraft((d) => ({ ...d, consent: e.target.checked }))} />
          <span>{CONSENT}</span>
        </label>
        <button type="button" className="sx-btn sx-btn-ghost" disabled={Boolean(busy)} onClick={addPerson}>{busy === 'add' ? 'Adding…' : 'Add person'}</button>
      </div>
    </div>
  );
}
