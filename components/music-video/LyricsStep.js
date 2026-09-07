'use client';

export default function LyricsStep({ mode, onModeChange, value, onChange }) {
  return <section className="cinex-music-source-options" aria-labelledby="lyrics-step-title"><h2 id="lyrics-step-title">Step 2: Lyrics</h2><select value={mode} onChange={(event) => onModeChange(event.target.value)}><option value="official">I have official lyrics</option><option value="transcription-draft">Transcribe my song (demo draft)</option><option value="instrumental">This is instrumental</option></select>{mode !== 'instrumental' && <label>Editable lyric lines<textarea value={value} onChange={(event) => onChange(event.target.value)} rows={5} placeholder="One lyric line per row..." /><span className="cinex-form-optional">Automatic transcription is a draft. Review lyrics and timing before using lip-sync planning.</span></label>}</section>;
}
