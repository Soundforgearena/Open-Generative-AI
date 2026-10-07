'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getPremieresReadiness, testStorageServer } from '@/lib/cinexvideo-client';

function Row({ ok, title, children }) {
  return (
    <li className={ok ? 'is-ok' : 'is-missing'}>
      <span aria-hidden="true">{ok ? '✓' : '○'}</span> <strong>{title}</strong> {children}
    </li>
  );
}

/**
 * CineX Premieres + Creator Vault launch checklist. Everything here stays
 * "coming soon" until the storage server and safety scanning are connected.
 */
export default function PremieresReadiness() {
  const [state, setState] = useState(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPremieresReadiness().then(setState).catch((e) => setStatus(e.message || 'Could not load Premieres status.'));
  }, []);

  async function test() {
    setBusy(true);
    setStatus('');
    try {
      const r = await testStorageServer();
      setStatus(r.ok ? `Storage server works: wrote, read and deleted a test file in ${r.ms} ms.` : `Storage test failed at the ${r.step} step${r.status ? ` (HTTP ${r.status})` : ''}. Check the keys and bucket name.`);
    } catch (e) {
      setStatus(e.message);
    } finally {
      setBusy(false);
    }
  }

  const storage = state?.storage;
  const moderation = state?.moderation;
  return (
    <section className="cinex-visibility-card cinex-payment-mode" aria-labelledby="premieres-ready-title">
      <div className="cinex-visibility-copy">
        <p className="cinex-route-eyebrow">Coming soon</p>
        <h2 id="premieres-ready-title">CineX Premieres &amp; Creator Vault</h2>
        <p>The public streaming page and paid creator storage stay in “coming soon” until these are connected. <Link href="/premieres">Preview the page</Link> · <Link href="/content-policy">Content policy</Link></p>
        {state && (
          <ul className="cinex-payment-checks">
            <Row ok={storage?.configured} title="Storage server">
              {storage?.configured
                ? `${storage.provider} · bucket ${storage.bucket}${storage.cdn ? ' · CDN on' : ''}`
                : <>Add in Railway: <code>{storage?.missing.join(', ')}</code>. Works with Cloudflare R2 (recommended, no viewer bandwidth fees), Backblaze B2, Wasabi, AWS S3 or your own server running MinIO.</>}
            </Row>
            <Row ok={moderation?.configured} title="Safety scanning">
              {moderation?.configured ? `Connected: ${moderation.provider}` : <>Add <code>MODERATION_PROVIDER</code> (sightengine, hive or rekognition) and its keys. Until then every upload would need manual review.</>}
            </Row>
            <Row ok={state.ads?.configured} title="Ad server">
              {state.ads?.configured ? 'VAST ad tag connected.' : <>Add <code>ADS_VAST_TAG_URL</code> from Google Ad Manager (or any VAST ad server) once your ad account is approved.</>}
            </Row>
            <Row ok title="Free episodes">Episodes 1–5 free with ads; creators set the unlock price for the rest (50–2,000 credits).</Row>
            <Row ok title="Content policy">Draft {state.policy_version} published at /content-policy. Have counsel review before launch.</Row>
            <Row ok title="Revenue split">60% creator / 40% CineXVideo on ads and skip-ads purchases, paid through Stripe Connect.</Row>
            <Row ok={state.waitlist.total > 0} title="Waitlist">{state.waitlist.total} signed up · {state.waitlist.creators} creators</Row>
          </ul>
        )}
      </div>
      <div className="cinex-visibility-control">
        <span className="cinex-visibility-state">Coming soon</span>
        <button type="button" className="cinex-route-secondary" disabled={busy || !storage?.configured} onClick={test}>
          {busy ? 'Testing...' : 'Test storage server'}
        </button>
      </div>
      {status && <p className="cinex-visibility-status" role="status">{status}</p>}
    </section>
  );
}
