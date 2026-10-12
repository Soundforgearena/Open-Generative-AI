'use client';

import { useEffect, useRef, useState } from 'react';
import { getR2StorageConnection, connectR2Storage } from '@/lib/cinexvideo-client';

export default function R2StorageSettings({ loadConnection = getR2StorageConnection, connect = connectR2Storage, readOnlyMessage = null }) {
  const [state, setState] = useState(null);
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [binding, setBinding] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const locked = useRef(false);
  useEffect(() => {
    let mounted = true;
    loadConnection().then((data) => {
      if (mounted) { setState(data); setBinding(data.storage || {}); }
    }).catch((e) => { if (mounted) setError(e.message || 'Could not load storage settings.'); });
    return () => { mounted = false; };
  }, [loadConnection]);

  async function submit(event) {
    event.preventDefault();
    if (locked.current) return;
    locked.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await connect({
        accessKeyId, secretAccessKey,
        binding: { accountId: binding.accountId, bucket: binding.bucket, jurisdiction: binding.jurisdiction },
      });
      setState(result);
      setBinding(result.storage);
      setNotice('Cloudflare R2 connected. Write, read and cleanup verified. New reference and soundtrack uploads now use private R2 storage.');
    } catch (e) { setError(e.message || 'Cloudflare R2 could not be connected.'); }
    finally {
      // Submitted credentials are never reloaded, persisted in browser storage,
      // or displayed after an attempt, including a failed attempt.
      setAccessKeyId(''); setSecretAccessKey('');
      setBusy(false); locked.current = false;
    }
  }

  const storage = state?.storage;
  const disabled = busy || !state?.canChange || !storage?.encryptionReady;
  return (
    <section className="cinex-visibility-card" aria-labelledby="r2-settings-title" style={{ display: 'block', maxWidth: 900 }}>
      <p className="cinex-route-eyebrow">Media storage</p>
      <h2 id="r2-settings-title">Cloudflare R2</h2>
      <p className="cinex-route-description">Enter your two R2 keys. CineXVideo handles the endpoint and private media transfers; no Railway edits or browser CORS setup are needed.</p>
      <p role="status"><strong>{storage?.verified ? 'Connected and verified' : state ? 'Not connected' : 'Loading storage settings...'}</strong>
        {storage?.verifiedAt && <> · Last verified {new Date(storage.verifiedAt).toLocaleString()}</>}
      </p>
      {storage && <p className="cinex-route-description">Private bucket: <code>{storage.bucket}</code>{storage.keyHint ? ` · Saved access key ending ${storage.keyHint}` : ''}</p>}
      {state && !storage.encryptionReady && <p className="cinex-form-error" role="alert">The deployment needs its server encryption key initialized before credentials can be saved. Do not paste keys until this message clears.</p>}
      {state && !state.canChange && <p className="cinex-route-description">{readOnlyMessage || 'Only the super admin can connect or rotate storage credentials.'}</p>}
      <form onSubmit={submit} autoComplete="off">
        <div style={{ display: 'grid', gap: 16, margin: '20px 0' }}>
          <label className="cinex-admin-field">R2 Access Key ID
            <input aria-label="R2 Access Key ID" className="cinex-route-input" type="password" autoComplete="new-password" spellCheck={false} value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} disabled={disabled} required maxLength={32} style={{ display: 'block', width: '100%', marginTop: 8 }} />
          </label>
          <label className="cinex-admin-field">R2 Secret Access Key
            <input aria-label="R2 Secret Access Key" className="cinex-route-input" type="password" autoComplete="new-password" spellCheck={false} value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} disabled={disabled} required maxLength={64} style={{ display: 'block', width: '100%', marginTop: 8 }} />
          </label>
        </div>
        <p className="cinex-route-description">Keys are encrypted on the server and are never shown again. Connecting writes, reads and removes one tiny test object. If the displayed bucket is missing, CineXVideo attempts to create it privately when your keys permit; it never changes DNS or makes media public.</p>
        <details style={{ margin: '18px 0' }}>
          <summary>Advanced: a different existing bucket or jurisdiction</summary>
          <p className="cinex-route-description">The normal setup needs only the two keys above. Account and bucket cannot be changed after connection without a deliberate media migration.</p>
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            <label className="cinex-admin-field">Cloudflare account ID <input className="cinex-route-input" aria-label="Cloudflare account ID" value={binding.accountId || ''} onChange={(e) => setBinding({ ...binding, accountId: e.target.value })} disabled={disabled || storage?.configured} /></label>
            <label className="cinex-admin-field">Bucket <input className="cinex-route-input" aria-label="Bucket" value={binding.bucket || ''} onChange={(e) => setBinding({ ...binding, bucket: e.target.value })} disabled={disabled || storage?.configured} /></label>
            <label className="cinex-admin-field">Jurisdiction <select aria-label="Jurisdiction" value={binding.jurisdiction || 'default'} onChange={(e) => setBinding({ ...binding, jurisdiction: e.target.value })} disabled={disabled || storage?.configured}>
              <option value="default">Default</option><option value="eu">European Union</option><option value="us">United States</option><option value="fedramp">FedRAMP</option>
            </select></label>
          </div>
        </details>
        <button className="cinex-route-primary" type="submit" disabled={disabled || !accessKeyId || !secretAccessKey}>{busy ? 'Connecting and verifying...' : storage?.configured ? 'Rotate keys and verify' : 'Connect Cloudflare R2'}</button>
      </form>
      {error && <p className="cinex-form-error" role="alert">{error}</p>}
      {notice && <p className="cinex-visibility-status" role="status">{notice}</p>}
    </section>
  );
}
