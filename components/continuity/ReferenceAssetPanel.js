export default function ReferenceAssetPanel({ references = [] }) {
  return <section className="cinex-continuity-section"><h3>Reference set</h3><p>Demo mode stores metadata only. No reference binary is uploaded to localStorage.</p><div className="cinex-reference-list">{['Hero/front', '3/4 left', '3/4 right', 'Wardrobe look', 'Location'].map((label) => <span key={label} className={references.includes(label) ? 'is-present' : ''}>{label}{references.includes(label) ? ' · ready' : ' · expected'}</span>)}</div></section>;
}
