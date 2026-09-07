'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import CinexRoutePage from '@/components/CinexRoutePage';
import { demoModeEnabled } from '@/lib/demo-mode';
import { getMusicProject, saveMusicProject } from '@/lib/music-video-demo';
import { createInstrumentalShotPlan, createLyricAwareShotPlan } from '@/lib/music-video-director';
import BeatStoryboard from '@/components/music-video/BeatStoryboard';
import ContinuityGuardianPanel from '@/components/continuity/ContinuityGuardianPanel';

function StoryboardContent() {
  const params = useSearchParams();
  const [project, setProject] = useState(null);
  const [message, setMessage] = useState('Loading storyboard...');
  useEffect(() => { const next = demoModeEnabled ? getMusicProject(params.get('project')) : null; if (!next) { setMessage('Music project not found.'); return; } const storyboard = next.storyboard?.length ? next.storyboard : (next.lyricsMode === 'instrumental' ? createInstrumentalShotPlan(next) : createLyricAwareShotPlan(next)); const updated = { ...next, storyboard }; setProject(updated); saveMusicProject(updated); }, [params]);
  if (!project) return <CinexRoutePage eyebrow="Music Video Storyboard" title="Storyboard" description={message}><Link href="/music-video" className="cinex-route-primary">Back to Music Video Studio</Link></CinexRoutePage>;
  function updateShot(index, patch) { const storyboard = project.storyboard.map((shot, shotIndex) => shotIndex === index ? { ...shot, ...patch } : shot); const updated = { ...project, storyboard }; setProject(updated); saveMusicProject(updated); }
  function move(index, direction) { const target = index + direction; if (target < 0 || target >= project.storyboard.length) return; const storyboard = [...project.storyboard]; [storyboard[index], storyboard[target]] = [storyboard[target], storyboard[index]]; setProject({ ...project, storyboard }); saveMusicProject({ ...project, storyboard }); }
  return <CinexRoutePage eyebrow="Music Video Storyboard" title="Beat & lyric storyboard" description="Review the full song timeline before any real generation step.">
    <p className="cinex-demo-indicator">Demo Music Video Studio — local planning only. No audio is uploaded, transcribed, generated, or sent to a provider.</p>
    <div className="cinex-music-project-summary"><strong>{project.title}</strong><span>{project.audioDurationSeconds}s total · {project.storyboard.length} planned shots</span><span>{project.lyricsMode === 'instrumental' ? 'Instrumental mode' : project.lyricsMode === 'confirmed' ? 'Eligible after lyrics are confirmed' : 'Not enabled — lyrics need review'}</span></div>
    <ContinuityGuardianPanel project={project} onFix={() => window.location.assign(`/music-video/director?project=${encodeURIComponent(project.id)}`)} />
      <BeatStoryboard storyboard={project.storyboard} onEdit={updateShot} onMove={move} />
    <div className="cinex-dashboard-actions"><Link href={`/music-video/review?project=${encodeURIComponent(project.id)}`} className="cinex-route-primary">Continue to Review</Link><Link href={`/music-video/director?project=${encodeURIComponent(project.id)}`} className="cinex-route-secondary-link">Back to Director</Link></div>
  </CinexRoutePage>;
}
export default function MusicVideoStoryboardPage() { return <Suspense fallback={<main className="cinex-dashboard-loading">Loading storyboard...</main>}><StoryboardContent /></Suspense>; }
