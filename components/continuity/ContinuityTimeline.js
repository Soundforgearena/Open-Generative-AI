'use client';

export default function ContinuityTimeline({ items = [] }) {
  return <section className="cinex-continuity-section" aria-label="Continuity timeline"><h3>Continuity timeline</h3><div className="cinex-continuity-timeline">{items.map((item, index) => <article key={item.id || index}><strong>{item.title || `Shot ${index + 1}`}</strong><span>{item.startSeconds ?? 0}s–{item.endSeconds ?? 0}s</span><small>{item.continuity?.handoffNotes?.[0] || 'No handoff note yet.'}</small></article>)}</div></section>;
}
