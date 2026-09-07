'use client';

import { useRef, useState } from 'react';
import { uploadReference, deleteReference } from '@/lib/cinexvideo-client';

const KINDS = [
  { value: 'character', label: 'Character', accept: 'image/jpeg,image/png,image/webp', hint: 'JPG, PNG or WebP up to 15 MB' },
  { value: 'outfit', label: 'Outfit', accept: 'image/jpeg,image/png,image/webp', hint: 'JPG, PNG or WebP up to 15 MB' },
  { value: 'location', label: 'Location', accept: 'image/jpeg,image/png,image/webp', hint: 'JPG, PNG or WebP up to 15 MB' },
  { value: 'prop', label: 'Prop', accept: 'image/jpeg,image/png,image/webp', hint: 'JPG, PNG or WebP up to 15 MB' },
  { value: 'reference', label: 'Reference still', accept: 'image/jpeg,image/png,image/webp', hint: 'JPG, PNG or WebP up to 15 MB' },
  { value: 'audio', label: 'Audio track', accept: 'audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg,audio/flac', hint: 'MP3, WAV, M4A, AAC, OGG or FLAC up to 60 MB' },
];

function kindConfig(value) {
  return KINDS.find((kind) => kind.value === value) || KINDS[0];
}

export default function ReferenceUploader({ projectId, assets = [], onAssetsChange }) {
  const inputRef = useRef(null);
  const [kind, setKind] = useState('reference');
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const config = kindConfig(kind);

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    setBusy(true);
    setError('');
    setStatus('');

    const uploaded = [];
    for (const file of files) {
      try {
        const asset = await uploadReference(projectId, file, { kind });
        if (asset) uploaded.push(asset);
      } catch (uploadError) {
        setError(uploadError.message || `${file.name} could not be uploaded.`);
        break;
      }
    }

    if (uploaded.length) {
      onAssetsChange?.([...assets, ...uploaded]);
      setStatus(`${uploaded.length} file${uploaded.length === 1 ? '' : 's'} added to your reference library.`);
    }

    if (inputRef.current) inputRef.current.value = '';
    setBusy(false);
  }

  async function handleRemove(asset) {
    setRemovingId(asset.id);
    setError('');
    setStatus('');
    try {
      await deleteReference(asset.id);
      onAssetsChange?.(assets.filter((item) => item.id !== asset.id));
      setStatus(`${asset.name} was removed.`);
    } catch (removeError) {
      setError(removeError.message || 'That reference could not be removed.');
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section className="cinex-uploader" aria-labelledby="reference-library-title">
      <h2 id="reference-library-title">Reference library</h2>
      <p className="cinex-form-optional">
        Upload character, wardrobe, location and prop stills plus your own audio. Files are stored privately and
        are only ever served to you through short-lived links.
      </p>

      <div className="cinex-uploader-controls">
        <label className="cinex-uploader-kind">
          Reference type
          <select value={kind} onChange={(event) => setKind(event.target.value)} disabled={busy}>
            {KINDS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="cinex-uploader-file">
          Choose files
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={config.accept}
            disabled={busy}
            onChange={(event) => handleFiles(event.target.files)}
          />
          <span className="cinex-form-optional">{config.hint}</span>
        </label>
      </div>

      {busy && <p className="cinex-form-success" role="status">Uploading...</p>}
      {status && !busy && <p className="cinex-form-success" role="status">{status}</p>}
      {error && <p className="cinex-form-error" role="alert">{error}</p>}

      {assets.length ? (
        <ul className="cinex-uploader-list">
          {assets.map((asset) => (
            <li key={asset.id} className="cinex-uploader-item">
              <div className="cinex-uploader-preview">
                {asset.kind === 'audio' ? (
                  asset.preview_url ? (
                    <audio controls preload="none" src={asset.preview_url}>
                      Your browser cannot play this audio file.
                    </audio>
                  ) : (
                    <span className="cinex-uploader-placeholder">Audio</span>
                  )
                ) : asset.preview_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={asset.preview_url} alt={asset.name} loading="lazy" />
                ) : (
                  <span className="cinex-uploader-placeholder">No preview</span>
                )}
              </div>
              <div className="cinex-uploader-meta">
                <strong>{asset.name}</strong>
                <span>{kindConfig(asset.kind).label}</span>
              </div>
              <button
                type="button"
                className="cinex-auth-secondary"
                onClick={() => handleRemove(asset)}
                disabled={removingId === asset.id || asset.locked}
              >
                {removingId === asset.id ? 'Removing...' : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="cinex-dashboard-empty">No references uploaded yet.</p>
      )}
    </section>
  );
}
