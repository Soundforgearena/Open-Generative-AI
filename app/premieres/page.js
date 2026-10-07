'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { SAMPLE_SERIES, TABS, formatViews, mostLoved, seriesForTab } from '@/lib/premieres/catalog';
import { AD_RULES, CREATOR_SHARE, FREE_EPISODES, PLATFORM_SHARE, SKIP_ADS_OPTIONS, UNLOCK_PRICE_LIMITS, adBreaksForEpisode, estimateEarnings, isEpisodeFree, unlockBreakdown } from '@/lib/premieres/revenue';
import { STORAGE_PLANS } from '@/lib/storage/plans';

const money = (cents) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const VIEW_STEPS = [1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000];

function Icon({ name }) {
  const p = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  const d = {
    home: <path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z" />,
    play: <><circle cx="12" cy="12" r="9" /><path d="M10 8.5v7l6-3.5z" fill="currentColor" /></>,
    gift: <><rect x="3" y="8" width="18" height="13" rx="1.5" /><path d="M12 8v13M3 12h18M12 8c-2-4-6-4-6-1.5S9 8 12 8zm0 0c2-4 6-4 6-1.5S15 8 12 8z" /></>,
    list: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M10 9v6l5-3z" fill="currentColor" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
    shield: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>,
    close: <path d="M6 6l12 12M18 6L6 18" />,
    heart: <path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z" />,
    share: <><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6" /></>,
    lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>,
  }[name];
  return <svg {...p}>{d}</svg>;
}

function Poster({ series, rank, onOpen }) {
  return (
    <button type="button" className="px-card" onClick={() => onOpen(series)} aria-label={`${series.title}, ${series.genre}, ${formatViews(series.views)} plays`}>
      <span className="px-poster">
        <img src={`/premieres/${series.slug}.webp`} alt="" loading="lazy" width="600" height="800" />
        {series.isNew && <span className="px-badge">New</span>}
        {series.vip && !series.isNew && <span className="px-badge is-vip">VIP</span>}
        {rank && <span className="px-rank" aria-hidden="true">{rank}</span>}
        <span className="px-views"><svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>{formatViews(series.views)}</span>
        <span className="px-shine" aria-hidden="true" />
      </span>
      <span className="px-title">{series.title}</span>
      <span className="px-card-meta">
        <span className="px-chip">{series.genre}</span>
        <span className="px-likes" aria-label={`${formatViews(series.likes)} likes`}><Icon name="heart" />{formatViews(series.likes)}</span>
      </span>
    </button>
  );
}

function Waitlist({ compact = false }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [state, setState] = useState({ busy: false, done: false, error: '' });
  async function submit(e) {
    e.preventDefault();
    setState({ busy: true, done: false, error: '' });
    try {
      const res = await fetch('/api/premieres/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, role }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save your spot.');
      setState({ busy: false, done: true, error: '' });
    } catch (error) {
      setState({ busy: false, done: false, error: error.message });
    }
  }
  if (state.done) return <p className="px-joined" role="status">You’re on the list. We’ll email you the moment Premieres opens{role === 'creator' ? ', with early creator access' : ''}.</p>;
  return (
    <form className={`px-waitlist ${compact ? 'is-compact' : ''}`} onSubmit={submit}>
      <div className="px-role" role="radiogroup" aria-label="I want to">
        {[['viewer', 'Watch'], ['creator', 'Publish & earn']].map(([key, label]) => (
          <button key={key} type="button" role="radio" aria-checked={role === key} className={role === key ? 'is-on' : ''} onClick={() => setRole(key)}>{label}</button>
        ))}
      </div>
      <div className="px-waitlist-row">
        <label className="px-sr" htmlFor={`px-email-${compact ? 'b' : 'a'}`}>Email address</label>
        <input id={`px-email-${compact ? 'b' : 'a'}`} type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit" className="px-cta" disabled={state.busy}>{state.busy ? 'Saving...' : 'Get early access'}</button>
      </div>
      {state.error && <p className="px-error" role="alert">{state.error}</p>}
    </form>
  );
}

export default function PremieresPage() {
  const [tab, setTab] = useState('Popular');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(null);
  const [viewsIndex, setViewsIndex] = useState(6);
  const [waiting, setWaiting] = useState(null);
  const [toast, setToast] = useState('');
  const dialogRef = useRef(null);
  const [liked, setLiked] = useState({});
  const [shared, setShared] = useState({});
  const loved = useMemo(() => mostLoved(SAMPLE_SERIES, 6), []);
  const demoScenes = [45, 60, 50, 70, 40, 65, 55, 80, 45, 60]; // a 9-minute sample episode
  const demoBreaks = useMemo(() => adBreaksForEpisode(demoScenes), []); // eslint-disable-line react-hooks/exhaustive-deps
  const demoTotal = demoScenes.reduce((a, b) => a + b, 0);

  useEffect(() => {
    try { setLiked(JSON.parse(localStorage.getItem('cinex-premieres-likes') || '{}')); } catch { /* ignore */ }
  }, []);
  function toggleLike(slug) {
    setLiked((cur) => {
      const next = { ...cur, [slug]: !cur[slug] };
      try { localStorage.setItem('cinex-premieres-likes', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }
  async function share(series) {
    const url = `${window.location.origin}/premieres?series=${series.slug}`;
    const data = { title: `${series.title} on CineX Premieres`, text: series.logline, url };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(url); setToast('Link copied. Share it anywhere.'); }
      setShared((cur) => ({ ...cur, [series.slug]: true }));
    } catch { /* share sheet closed */ }
  }

  const rows = useMemo(() => seriesForTab(tab, SAMPLE_SERIES, query), [tab, query]);
  const earnings = useMemo(() => estimateEarnings({ views: VIEW_STEPS[viewsIndex] }), [viewsIndex]);

  useEffect(() => {
    fetch('/api/premieres/waitlist').then((r) => r.json()).then((d) => setWaiting(Number(d.count) || 0)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const soon = (what) => setToast(`${what} opens with Premieres. Join the waitlist to be first in.`);

  return (
    <main className="px-root">
      <header className="px-top">
        <Link href="/" className="px-brand" aria-label="CineXVideo home">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l16 8-16 8z" fill="none" stroke="#e7b75f" strokeWidth="1.8" strokeLinejoin="round" /><path d="M8 9l6 3-6 3z" fill="#e7b75f" /></svg>
          <span>CINEX <b>PREMIERES</b></span>
        </Link>
        <label className="px-search">
          <span className="px-sr">Search series</span>
          <input type="search" placeholder="Search dragons, mysteries, music..." value={query} onChange={(e) => setQuery(e.target.value)} />
          <Icon name="search" />
        </label>
        <span className="px-soon-pill">Coming soon</span>
        <Link href="/studio" className="px-studio-link">Open Studio</Link>
      </header>

      <section className="px-hero" aria-labelledby="px-hero-title">
        <img className="px-hero-art" src="/premieres/hero.webp" alt="" />
        <div className="px-hero-fade" aria-hidden="true" />
        <div className="px-hero-copy">
          <p className="px-eyebrow"><span className="px-live-dot" aria-hidden="true" /> Premiering soon on CineXVideo</p>
          <h1 id="px-hero-title">Make it in the studio.<br /><em>Premiere it to the world.</em></h1>
          <p className="px-lede">A home for AI-made series, episodes and music videos. Viewers watch free with ads or skip them with credits. Creators keep <strong>{Math.round(CREATOR_SHARE * 100)}%</strong> of everything their series earns.</p>
          <Waitlist />
          {waiting !== null && waiting > 0 && <p className="px-count">{waiting.toLocaleString()} {waiting === 1 ? 'person is' : 'people are'} already waiting</p>}
        </div>
      </section>

      <nav className="px-tabs" aria-label="Browse">
        {TABS.map((t) => (
          <button key={t} type="button" className={t === tab ? 'is-on' : ''} aria-pressed={t === tab} onClick={() => setTab(t)}>{t}</button>
        ))}
        <span className="px-preview-note">Preview titles</span>
      </nav>

      <section className="px-grid" aria-label={`${tab} series`}>
        {rows.map((s, i) => <Poster key={s.slug} series={s} rank={tab === 'Ranking' ? i + 1 : null} onOpen={setOpen} />)}
        {!rows.length && <p className="px-empty">No preview titles match “{query}”.</p>}
      </section>

      <section className="px-loved" aria-labelledby="px-loved-title">
        <div className="px-row-head">
          <h2 id="px-loved-title">Most loved this week</h2>
          <span>Ranked by likes, shares and plays</span>
        </div>
        <div className="px-loved-row">
          {loved.map((s, i) => (
            <button type="button" key={s.slug} className="px-loved-card" onClick={() => setOpen(s)}>
              <img src={`/premieres/${s.slug}.webp`} alt="" loading="lazy" width="600" height="800" />
              <span className="px-loved-rank" aria-hidden="true">{i + 1}</span>
              <span className="px-loved-info">
                <strong>{s.title}</strong>
                <span><Icon name="heart" />{formatViews(s.likes + (liked[s.slug] ? 1 : 0))}</span>
                <span><Icon name="share" />{formatViews(s.shares + (shared[s.slug] ? 1 : 0))}</span>
                <span><Icon name="play" />{formatViews(s.views)}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="px-band px-model" aria-labelledby="px-model-title">
        <p className="px-eyebrow">How watching works</p>
        <h2 id="px-model-title">First {FREE_EPISODES} episodes free. <em>Then it is the creator’s call.</em></h2>
        <div className="px-ladder">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <span key={n} className={isEpisodeFree(n) ? 'is-free' : 'is-paid'}>
              {isEpisodeFree(n) ? null : <Icon name="lock" />}EP {n}
            </span>
          ))}
        </div>
        <div className="px-model-grid">
          <article><h3>Episodes 1–{FREE_EPISODES}: free</h3><p>Anyone can watch, with short ads. Viewers can skip those ads for {SKIP_ADS_OPTIONS[0].credits} credits an episode or with a 30-day pass.</p></article>
          <article className="is-featured"><h3>Episode {FREE_EPISODES + 1} onward: unlock the series</h3><p>The owner sets one price to unlock every remaining episode, from {UNLOCK_PRICE_LIMITS.min} to {UNLOCK_PRICE_LIMITS.max.toLocaleString()} credits. Unlocked episodes are ad-free and stay unlocked for good.</p></article>
          <article><h3>Who gets what</h3><p>On a {UNLOCK_PRICE_LIMITS.suggested}-credit unlock, after payment fees, the creator gets <strong>{unlockBreakdown(UNLOCK_PRICE_LIMITS.suggested).creator} credits</strong> and CineXVideo {unlockBreakdown(UNLOCK_PRICE_LIMITS.suggested).platform}. The same 60/40 split as ads.</p></article>
        </div>
      </section>

      <section className="px-band px-ads" aria-labelledby="px-ads-title">
        <p className="px-eyebrow">How ads fit in</p>
        <h2 id="px-ads-title">Ads that never cut a scene in half</h2>
        <p className="px-band-lede">Because every episode is built in the CineX studio, we know exactly where each scene ends. Ads only ever drop in at those cuts.</p>
        <div className="px-timeline" aria-label="Sample 9-minute free episode with ad breaks">
          <div className="px-timeline-bar">
            {demoScenes.map((d, i) => <span key={i} className="px-scene" style={{ flexGrow: d }} title={`Scene ${i + 1}`} />)}
            {demoBreaks.map((b) => (
              <span key={b.at} className={`px-ad-mark is-${b.type}`} style={{ left: `${(b.at / demoTotal) * 100}%` }}>
                <span>{b.type === 'pre-roll' ? `Pre-roll ${b.seconds}s` : `Ad ${b.seconds}s`}</span>
              </span>
            ))}
          </div>
          <div className="px-timeline-scale"><span>0:00</span><span>Scene cuts</span><span>{Math.floor(demoTotal / 60)}:{String(demoTotal % 60).padStart(2, '0')}</span></div>
        </div>
        <ul className="px-rules">
          <li>One {AD_RULES.preRollSeconds}-second pre-roll on free episodes</li>
          <li>Mid-rolls only at scene cuts, at least {AD_RULES.minGapSeconds / 60} minutes apart, at most {AD_RULES.maxMidRolls}</li>
          <li>No ads in the last {AD_RULES.noAdsInLastSeconds} seconds, so endings land</li>
          <li>Unlocked episodes and skip-ads viewers see no ads at all</li>
          <li>Family-safe ad categories only, matching our content policy</li>
          <li>Served through standard VAST ad servers such as Google Ad Manager</li>
        </ul>
      </section>

      <section className="px-band px-earn" aria-labelledby="px-earn-title">
        <div className="px-band-copy">
          <p className="px-eyebrow">For creators</p>
          <h2 id="px-earn-title">Your series. Your audience. <em>Your 60%.</em></h2>
          <p>Every dollar your series makes, from ads and from viewers paying to skip them, is split {Math.round(CREATOR_SHARE * 100)}/{Math.round(PLATFORM_SHARE * 100)}. You keep {Math.round(CREATOR_SHARE * 100)}%. CineXVideo keeps {Math.round(PLATFORM_SHARE * 100)}% to run the servers, streaming and safety review. Payouts go straight to your bank through Stripe.</p>
          <div className="px-split" aria-hidden="true"><span style={{ flexBasis: `${CREATOR_SHARE * 100}%` }}>You 60%</span><span>CineX 40%</span></div>
        </div>
        <div className="px-calc">
          <label htmlFor="px-views">Monthly views: <strong>{VIEW_STEPS[viewsIndex].toLocaleString()}</strong></label>
          <input id="px-views" type="range" min="0" max={VIEW_STEPS.length - 1} step="1" value={viewsIndex} onChange={(e) => setViewsIndex(Number(e.target.value))} />
          <div className="px-calc-out">
            <div><span>You earn</span><strong className="is-gold">{money(earnings.creator)}</strong></div>
            <div><span>CineXVideo</span><strong>{money(earnings.platform)}</strong></div>
          </div>
          <p className="px-fine">Estimate only. Assumes about $4 in net ad revenue per 1,000 ad views, and 3% of viewers paying {SKIP_ADS_OPTIONS[0].credits} credits to skip ads on an episode. Real earnings depend on your audience, country and advertisers.</p>
        </div>
      </section>

      <section className="px-band px-viewers" aria-labelledby="px-view-title">
        <p className="px-eyebrow">For viewers</p>
        <h2 id="px-view-title">Watch free, or skip the ads</h2>
        <div className="px-skip">
          <article><h3>Free with ads</h3><p>Every episode, every series. Short ads, never mid-scene.</p><strong>$0</strong></article>
          {SKIP_ADS_OPTIONS.map((o) => (
            <article key={o.code} className={o.code === 'pass_30d' ? 'is-featured' : ''}>
              <h3>{o.label}</h3>
              <p>{o.code === 'episode' ? 'One tap, no ads on this episode.' : 'No ads on anything for 30 days.'}</p>
              <strong>{o.credits} credits <small>· {money(o.credits)}</small></strong>
            </article>
          ))}
        </div>
        <p className="px-fine">Every skip-ads purchase is shared 60/40 with the series you watch.</p>
      </section>

      <section className="px-band px-vault" aria-labelledby="px-vault-title">
        <p className="px-eyebrow">Creator Vault</p>
        <h2 id="px-vault-title">Your own space for every episode</h2>
        <p className="px-band-lede">Keep your finished episodes, drafts and takes in the cloud, publish to Premieres from one place, and see exactly how much space you use. Upgrade or downgrade any time.</p>
        <div className="px-plans">
          {STORAGE_PLANS.map((plan) => (
            <article key={plan.code} className={`px-plan ${plan.featured ? 'is-featured' : ''}`}>
              {plan.featured && <span className="px-plan-flag">Most popular</span>}
              <h3>{plan.name}</h3>
              <p className="px-plan-gb">{plan.gb >= 1000 ? `${plan.gb / 1000} TB` : `${plan.gb} GB`}</p>
              <p className="px-plan-price">{money(plan.monthly_cents)}<small>/month</small></p>
              <p className="px-plan-blurb">{plan.blurb}</p>
              <button type="button" className="px-plan-btn" onClick={() => soon('Creator Vault')}>Coming soon</button>
            </article>
          ))}
        </div>
        <div className="px-meter" aria-hidden="true">
          <div className="px-meter-head"><span>Creator Vault · 100 GB</span><span>38.4 GB used</span></div>
          <div className="px-meter-bar"><span className="is-ep" style={{ width: '24%' }} /><span className="is-take" style={{ width: '10%' }} /><span className="is-ref" style={{ width: '4.4%' }} /></div>
          <div className="px-meter-key"><span className="is-ep">Episodes</span><span className="is-take">Takes</span><span className="is-ref">References</span></div>
        </div>
      </section>

      <section className="px-band px-safe" aria-labelledby="px-safe-title">
        <p className="px-eyebrow"><Icon name="shield" /> Safe by design</p>
        <h2 id="px-safe-title">Strict rules, reviewed by people</h2>
        <ol className="px-steps">
          <li><b>1</b><strong>Upload</strong><span>Creators agree to the content policy for every episode.</span></li>
          <li><b>2</b><strong>Automatic scan</strong><span>Every frame and the audio are checked for nudity, sexual or suggestive content, violence and hate.</span></li>
          <li><b>3</b><strong>Human review</strong><span>Any signal holds the episode for a trained reviewer who accepts or rejects it, with a written reason.</span></li>
          <li><b>4</b><strong>Premiere</strong><span>Only approved episodes go public. Viewers can report anything, at any time.</span></li>
        </ol>
        <ul className="px-rules">
          <li>No nudity, no sexual content, no visible private parts</li>
          <li>Cleavage-focused, revealing or suggestive shots are held for review</li>
          <li>Zero tolerance for anything sexualising minors, which we report to the authorities</li>
          <li>Rejected? Every creator can appeal once and gets a clear reason</li>
        </ul>
        <Link href="/content-policy" className="px-cta is-ghost">Read the full content policy</Link>
      </section>

      <section className="px-final">
        <h2>Be first in the front row</h2>
        <Waitlist compact />
      </section>

      <nav className="px-bottom" aria-label="Premieres">
        {[['home', 'Discover'], ['play', 'Shorts'], ['gift', 'Rewards'], ['list', 'My List'], ['user', 'Profile']].map(([icon, label], i) => (
          <button key={label} type="button" className={i === 0 ? 'is-on' : ''} onClick={() => (i === 0 ? window.scrollTo({ top: 0, behavior: 'smooth' }) : soon(label))}>
            <Icon name={icon} /><span>{label}</span>
          </button>
        ))}
      </nav>

      {open && (
        <div className="px-backdrop" role="presentation" onClick={() => setOpen(null)}>
          <section className="px-dialog" role="dialog" aria-modal="true" aria-labelledby="px-dialog-title" tabIndex={-1} ref={dialogRef} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="px-close" aria-label="Close" onClick={() => setOpen(null)}><Icon name="close" /></button>
            <div className="px-dialog-art"><img src={`/premieres/${open.slug}.webp`} alt="" /></div>
            <div className="px-dialog-body">
              <p className="px-eyebrow">{open.genre} · {open.episodes} episodes · preview title</p>
              <h2 id="px-dialog-title">{open.title}</h2>
              <p>{open.logline}</p>
              <div className="px-social">
                <button type="button" className={liked[open.slug] ? 'is-on' : ''} aria-pressed={!!liked[open.slug]} onClick={() => toggleLike(open.slug)}>
                  <Icon name="heart" /> {formatViews(open.likes + (liked[open.slug] ? 1 : 0))}
                </button>
                <button type="button" onClick={() => share(open)}><Icon name="share" /> {formatViews(open.shares + (shared[open.slug] ? 1 : 0))}</button>
                <span><Icon name="play" /> {formatViews(open.views)} plays</span>
              </div>
              <ol className="px-episodes">
                {Array.from({ length: open.episodes }, (_, i) => i + 1).map((n) => (
                  <li key={n} className={isEpisodeFree(n) ? '' : 'is-locked'}>
                    <span>EP {n}</span>
                    {isEpisodeFree(n) ? <span className="px-ep-free">Free</span> : <span className="px-ep-lock"><Icon name="lock" /> Unlock</span>}
                  </li>
                ))}
              </ol>
              <div className="px-dialog-actions">
                <button type="button" className="px-cta" onClick={() => soon('Watching')}>Watch EP 1 free</button>
                {open.episodes > FREE_EPISODES && (
                  <button type="button" className="px-cta is-ghost" onClick={() => soon('Unlocking')}>Unlock EP {FREE_EPISODES + 1}–{open.episodes} · {open.unlockCredits} credits</button>
                )}
              </div>
              <p className="px-fine">Price set by the creator. Free episodes have short ads; skip them for {SKIP_ADS_OPTIONS[0].credits} credits.</p>
            </div>
          </section>
        </div>
      )}

      {toast && <div className="px-toast" role="status" aria-live="polite">{toast}</div>}
    </main>
  );
}
