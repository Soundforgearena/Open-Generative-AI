'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import CinexRoutePage from '@/components/CinexRoutePage';
import { demoModeEnabled } from '@/lib/demo-mode';
import { createMusicProject, DEMO_TRACKS } from '@/lib/music-video-demo';
import MusicSourceStep from '@/components/music-video/MusicSourceStep';
import LyricsStep from '@/components/music-video/LyricsStep';

function MusicVideoNewContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [track, setTrack] = useState(DEMO_TRACKS[0]);
  const [rights, setRights] = useState(false);
  const [lyricsMode, setLyricsMode] = useState(params.get('lyrics') === 'instrumental' ? 'instrumental' : 'official');
  const [lyrics, setLyrics] = useState('');
  const [title, setTitle] = useState('');
  const [style, setStyle] = useState('Performance + narrative');
  const [feeling, setFeeling] = useState('euphoric');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  function submit(event) {
    event.preventDefault();
    if (!demoModeEnabled) { setMessage('Connect an authenticated account before processing music.'); return; }
    if (!rights) { setMessage('Confirm that you own this music or have permission before continuing.'); return; }
    setSaving(true);
    const draftLyrics = lyricsMode === 'transcription-draft' && !lyrics.trim() ? ['The night is opening', 'Follow the light', 'Every beat becomes a choice'] : lyrics.split('\n').filter(Boolean);
    const lyricLines = lyricsMode === 'instrumental' ? [] : draftLyrics.map((text, index) => ({ line: index + 1, text, start: index * 4, end: index * 4 + 4, confidence: lyricsMode === 'official' ? 'needs review' : 'draft', confirmed: false }));
    const project = createMusicProject({ title: title || track.title, track, rightsConfirmed: rights, lyricsMode, lyrics: draftLyrics.join('\n'), lyricLines, videoStyle: style, aspectRatio, visualDirection: { feeling, style } });
    window.setTimeout(() => router.push(`/music-video/director?project=${encodeURIComponent(project.id)}`), 250);
  }

  return <CinexRoutePage eyebrow="Music Video Studio" title="Set up your song" description="Choose a safe local demo profile, lyrics mode, and creative direction.">
    {demoModeEnabled && <p className="cinex-demo-indicator">Demo Music Video Studio — local planning only. No audio is uploaded, transcribed, generated, or sent to a provider.</p>}
    <form className="cinex-workflow-form" onSubmit={submit}>
      <div className="cinex-music-stepper"><span className="is-active">1 Music</span><span>2 Lyrics</span><span>3 Creative Direction</span><span>4 AI Director</span><span>5 Storyboard</span><span>6 Review</span></div>
      <label>Project title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Midnight Signal" /></label>
      <MusicSourceStep trackId={track.id} onTrackChange={setTrack} rights={rights} onRightsChange={setRights} />
      <LyricsStep mode={lyricsMode} onModeChange={setLyricsMode} value={lyrics} onChange={setLyrics} />
      <label>Video style<select value={style} onChange={(e) => setStyle(e.target.value)}><option>Performance</option><option>Narrative short film</option><option>Performance + narrative</option><option>Abstract / art film</option><option>Lyric video</option><option>Animated concept</option></select></label>
      <label>Final chorus feeling<select value={feeling} onChange={(e) => setFeeling(e.target.value)}><option>victorious</option><option>heartbroken</option><option>euphoric</option><option>mysterious</option><option>intimate</option><option>rebellious</option><option>hopeful</option></select></label>
      <label>Aspect ratio<select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}><option>16:9</option><option>9:16</option><option>1:1</option><option>2.39:1</option></select></label>
      <label className="cinex-check-row"><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} /> I confirm I own this music or have permission to create, generate, edit, and distribute a video using it.</label>
      <button type="submit" className="cinex-route-primary" disabled={saving}>{saving ? 'Saving music project...' : 'Continue to AI Director'}</button>
      <p className="cinex-form-optional">Only use music you created or have permission to use. Import support will be enabled after account and authorized-source integration.</p>
      {message && <p className="cinex-form-error" role="alert">{message}</p>}
    </form>
  </CinexRoutePage>;
}

export default function MusicVideoNewPage() {
  return <Suspense fallback={<main className="cinex-dashboard-loading">Loading music setup...</main>}><MusicVideoNewContent /></Suspense>;
}
