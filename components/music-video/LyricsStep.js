'use client';

export default function LyricsStep({ mode, onModeChange, value, onChange }) {
  return <section className="cinex-music-source-options" aria-labelledby="lyrics-step-title"><h2 id="lyrics-step-title">Step 2: Lyrics</h2><select value={mode} onChange={(event) => onModeChange(event.target.value)}><option value="official">I have official lyrics</option><option value="instrumental">This is instrumental</option></select>{mode !== 'instrumental' && <label>Editable lyric lines<textarea value={value} onChange={(event) => onChange(event.target.value)} rows={5} placeholder={'[Lead singer]\nOne lyric line per row...\n[Featured artist]\nTheir lines...'} /><span className="cinex-form-optional">Put each singer&apos;s name in brackets above their lines. In the Studio, CineXVideo times every line to your song and lip-syncs the singer to it.</span></label>}</section>;
}
