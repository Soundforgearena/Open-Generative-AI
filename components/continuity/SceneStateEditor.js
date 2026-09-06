'use client';

export default function SceneStateEditor({ scene, onChange }) {
  const continuity = scene?.continuity || { entryState: {}, exitState: {}, continuityLocks: [], allowedChanges: [], handoffNotes: [] };
  return <section className="cinex-continuity-section" aria-labelledby="scene-state-title"><h3 id="scene-state-title">Scene state</h3><p>Record what enters and exits the shot so the next clip has a handoff.</p><label>Entry emotional state<input value={continuity.entryState?.emotionalState || ''} onChange={(e) => onChange({ continuity: { ...continuity, entryState: { ...continuity.entryState, emotionalState: e.target.value } } })} /></label><label>Lighting<input value={continuity.entryState?.lighting || ''} onChange={(e) => onChange({ continuity: { ...continuity, entryState: { ...continuity.entryState, lighting: e.target.value } } })} /></label><label>Handoff notes<textarea value={(continuity.handoffNotes || []).join('\n')} onChange={(e) => onChange({ continuity: { ...continuity, handoffNotes: e.target.value.split('\n').filter(Boolean) } })} rows={3} /></label></section>;
}
