'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import CinexRoutePage from '@/components/CinexRoutePage';
import { demoModeEnabled } from '@/lib/demo-mode';
import { getMusicProject, saveMusicProject } from '@/lib/music-video-demo';
import ExportSettings from '@/components/music-video/ExportSettings';
import ContinuityGuardianPanel from '@/components/continuity/ContinuityGuardianPanel';

function ReviewContent() {
  const params = useSearchParams();
  const [project, setProject] = useState(null);
  const [message, setMessage] = useState('Loading review...');
  useEffect(() => { const next = demoModeEnabled ? getMusicProject(params.get('project')) : null; if (next) { setProject(next); setMessage(''); } else setMessage('Music project not found.'); }, [params]);
  if (!project) return <CinexRoutePage eyebrow="Music Video Review" title="Review project" description={message}><Link href="/music-video" className="cinex-route-primary">Back to Music Video Studio</Link></CinexRoutePage>;
  function simulate() { const statuses = ['planned', 'storyboard-ready', 'simulated-complete']; statuses.forEach((status, index) => window.setTimeout(() => { const next = { ...project, status }; setProject(next); saveMusicProject(next); if (status === 'simulated-complete') setMessage('Demo plan complete. No audio, transcription, video, lip sync, or credits were generated or used.'); }, (index + 1) * 600)); }
  return <CinexRoutePage eyebrow="Music Video Review" title="Ready for the next cut" description="Confirm rights, lyrics, timing, and the creative plan before any real production integration.">
    <p className="cinex-demo-indicator">Demo Music Video Studio — local planning only. No audio is uploaded, transcribed, generated, or sent to a provider.</p>
    <ContinuityGuardianPanel project={project} onFix={() => window.location.assign(`/music-video/storyboard?project=${encodeURIComponent(project.id)}`)} />
    <section className="cinex-shot-plan"><h2>{project.title}</h2><dl className="cinex-review-facts"><div><dt>Rights</dt><dd>{project.rightsConfirmed ? 'Confirmed for this demo plan' : 'Needs confirmation'}</dd></div><div><dt>Lyrics</dt><dd>{project.lyricsMode === 'instrumental' ? 'Instrumental mode' : project.lyricsMode === 'confirmed' ? 'Confirmed' : 'Draft — review before lip-sync'}</dd></div><div><dt>Timeline</dt><dd>{project.audioDurationSeconds}s · {project.storyboard.length} shots</dd></div><div><dt>Balance</dt><dd>Performance and narrative planning</dd></div></dl><p className="cinex-shot-plan-next">{project.lyricsMode === 'instrumental' ? 'Instrumental mode' : 'Lip-sync not enabled — lyrics need review.'}</p><div className="cinex-dashboard-actions"><button type="button" className="cinex-route-primary" onClick={simulate}>Simulate Music Video Production</button><Link href={`/music-video/storyboard?project=${encodeURIComponent(project.id)}`} className="cinex-route-secondary-link">Edit Storyboard</Link></div>{message && <p className="cinex-form-success" role="status">{message}</p>}{project.status === 'simulated-complete' && <Link href={`/music-video/projects/${encodeURIComponent(project.id)}`} className="cinex-route-primary">View completed project</Link>}</section>
    <ExportSettings value="preview" onChange={() => {}} />
  </CinexRoutePage>;
}
export default function MusicVideoReviewPage() { return <Suspense fallback={<main className="cinex-dashboard-loading">Loading music review...</main>}><ReviewContent /></Suspense>; }
