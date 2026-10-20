'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getModerationCases, reviewModerationCase, testModerationText } from '@/lib/cinexvideo-client';

const KIND = { prompt: 'Prompt', photo: 'Face photo + prompt', still: 'Generated still', take: 'Video take', director: 'AI Director request' };
const STATUS = { open: 'Open', confirmed: 'Confirmed', false_positive: 'False positive', reported: 'Reported' };
const when = (v) => (v ? new Date(v).toLocaleString() : '');
const isVideo = (url = '') => /\.(mp4|webm|mov)(\?|$)/i.test(url);

/** A preview that stays heavily blurred until the reviewer chooses to look. */
function BlurredPreview({ url }) {
  const [shown, setShown] = useState(false);
  if (!url) return <div className="cinex-mod-preview is-empty">No media (text only)</div>;
  return (
    <div className={`cinex-mod-preview${shown ? ' is-shown' : ''}`}>
      {isVideo(url)
        ? <video src={url} muted playsInline controls={shown} preload="metadata" />
        : <img src={url} alt="Blocked content preview" />}
      <button type="button" className="cinex-mod-reveal" onClick={() => setShown((v) => !v)} aria-pressed={shown}>
        {shown ? 'Blur again' : 'Reveal'}
      </button>
    </div>
  );
}

export default function ModerationQueue() {
  const [filter, setFilter] = useState('open');
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState('');
  const [probe, setProbe] = useState('');
  const [probeResult, setProbeResult] = useState(null);

  const load = useCallback(async (f = filter) => {
    try { setData(await getModerationCases(f)); } catch (e) { setStatus(e.message || 'Could not load the review queue.'); }
  }, [filter]);
  useEffect(() => { load(filter); }, [filter, load]);

  async function review(c, next) {
    if (next === 'reported' && !window.confirm('Mark this case as reported to the authorities? Keep the case reference from NCMEC or Cybertip.ca in the notes.')) return;
    const notes = next === 'reported' ? (window.prompt('Report reference (for example the NCMEC CyberTipline or Cybertip.ca number):') || '') : '';
    setBusy(c.id);
    try {
      await reviewModerationCase(c.id, next, notes);
      setStatus(next === 'false_positive' && c.account_suspended ? 'Marked as a false positive and the account was restored.' : `Case marked ${STATUS[next].toLowerCase()}.`);
      await load();
    } catch (e) { setStatus(e.message); } finally { setBusy(''); }
  }

  async function runProbe(e) {
    e.preventDefault();
    setProbeResult(null);
    try { setProbeResult(await testModerationText(probe)); } catch (err) { setProbeResult({ error: err.message }); }
  }

  const cases = data?.cases || [];
  return (
    <section className="cinex-admin-panel cinex-mod" aria-labelledby="mod-title">
      <div className="cinex-admin-panel-head">
        <div>
          <h2 id="mod-title">Moderation review queue</h2>
          <p>Everything blocked by the content checks: prompts, face photos, Director requests, and stills or takes withheld after they were made. Users were refunded and never saw withheld media. Previews stay blurred until you choose Reveal. Rules: <Link href="/content-policy">content policy</Link>.</p>
        </div>
        {data && (
          <div className="cinex-mod-counts">
            <span><strong>{data.counts.open}</strong> open</span>
            <span className={data.counts.severe_open ? 'is-alert' : ''}><strong>{data.counts.severe_open}</strong> child-safety open</span>
            <span><strong>{data.counts.total}</strong> total</span>
          </div>
        )}
      </div>
      <p className="cinex-mod-note">Child-safety cases: the account is suspended automatically and the media is preserved in quarantine. Report them to the <a href="https://report.cybertip.org/" target="_blank" rel="noreferrer">NCMEC CyberTipline</a> (US) or <a href="https://www.cybertip.ca/en/report/" target="_blank" rel="noreferrer">Cybertip.ca</a> (Canada), then mark the case reported with the report number. Do not download or share the media.</p>
      <div className="cinex-mod-filters" role="tablist" aria-label="Case status">
        {['open', 'confirmed', 'false_positive', 'reported', 'all'].map((f) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? 'is-current' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : STATUS[f]}</button>
        ))}
      </div>
      {status && <p className="cinex-visibility-status" role="status">{status}</p>}
      {data && !cases.length && <p className="cinex-mod-empty">No {filter === 'all' ? '' : STATUS[filter].toLowerCase() + ' '}cases.</p>}
      <ul className="cinex-mod-list">
        {cases.map((c) => (
          <li key={c.id} className={`cinex-mod-case${c.severe ? ' is-severe' : ''}`}>
            <BlurredPreview url={c.preview_url} />
            <div className="cinex-mod-body">
              <p className="cinex-mod-meta">
                <strong>{KIND[c.kind] || c.kind}</strong> · {when(c.created_at)} · {STATUS[c.status]}
                {c.severe ? <span className="cinex-mod-flag">Child safety</span> : null}
                {c.account_suspended ? <span className="cinex-mod-flag">Account suspended</span> : null}
              </p>
              <p className="cinex-mod-user">{c.email || c.user_id}</p>
              <p className="cinex-mod-cats">{(c.categories || []).map((k) => `${k} ${c.scores?.[k] ?? ''}`).join(' · ')}</p>
              {c.prompt_excerpt && <p className="cinex-mod-prompt">{c.prompt_excerpt}</p>}
              {c.notes && <p className="cinex-mod-notes">Notes: {c.notes}</p>}
              <div className="cinex-mod-actions">
                <button type="button" className="cinex-route-secondary" disabled={busy === c.id} onClick={() => review(c, 'confirmed')}>Confirm block</button>
                <button type="button" className="cinex-route-secondary" disabled={busy === c.id} onClick={() => review(c, 'false_positive')}>{c.account_suspended ? 'False positive (restore account)' : 'False positive'}</button>
                {c.severe ? <button type="button" className="cinex-route-secondary" disabled={busy === c.id} onClick={() => review(c, 'reported')}>Mark reported</button> : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <form className="cinex-mod-probe" onSubmit={runProbe}>
        <label htmlFor="mod-probe">Test a prompt (free, nothing is made or saved)</label>
        <div>
          <input id="mod-probe" value={probe} onChange={(e) => setProbe(e.target.value)} placeholder="Type a scene description to check" maxLength={4000} />
          <button type="submit" className="cinex-route-secondary" disabled={!probe.trim()}>Check</button>
        </div>
        {probeResult && (
          <p role="status">{probeResult.error ? probeResult.error : probeResult.unchecked ? 'The check service did not answer; this would be allowed and logged.' : probeResult.allowed ? 'Allowed.' : `Blocked: ${probeResult.labels.join(', ')}.${probeResult.alternative ? ` Users would be offered: “${probeResult.alternative.text}”` : ' No alternative offered.'}`}</p>
        )}
      </form>
    </section>
  );
}
