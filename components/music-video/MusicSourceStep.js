'use client';

import { DEMO_TRACKS } from '@/lib/music-video-demo';

export default function MusicSourceStep({ trackId, onTrackChange, rights, onRightsChange }) {
  return <section className="cinex-music-source-options" aria-labelledby="music-source-title"><h2 id="music-source-title">Step 1: Music</h2><label>Demo track profile<select value={trackId} onChange={(event) => onTrackChange(DEMO_TRACKS.find((track) => track.id === event.target.value))}>{DEMO_TRACKS.map((track) => <option key={track.id} value={track.id}>{track.title} · {track.duration}s · {track.bpm} BPM</option>)}</select><span className="cinex-form-optional">Demo track profile — no audio file is processed.</span></label><label>Upload MP3/WAV/M4A<input type="file" accept="audio/mpeg,audio/wav,audio/mp4" disabled /><span className="cinex-form-optional">Available after authenticated storage integration.</span></label><button type="button" className="cinex-auth-secondary" disabled>Connect an authorized music provider — coming after account integration</button><label className="cinex-check-row"><input type="checkbox" checked={rights} onChange={(event) => onRightsChange(event.target.checked)} /> I own this music or have permission to use it.</label></section>;
}
