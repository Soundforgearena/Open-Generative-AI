'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import CinexRoutePage from '@/components/CinexRoutePage';
import { demoModeEnabled } from '@/lib/demo-mode';
import { getMusicProject } from '@/lib/music-video-demo';

export default function MusicProjectDetailPage() {
  const params = useParams();
  const [project, setProject] = useState(null);
  useEffect(() => { if (demoModeEnabled) setProject(getMusicProject(params.id)); }, [params.id]);
  return <CinexRoutePage eyebrow="Music Video Project" title={project?.title || 'Project detail'} description="Storyboard simulation complete. Connect your account to generate a video.">{project ? <section className="cinex-shot-plan"><p className="cinex-demo-indicator">Demo preview — no audio, video, lip sync, or credits were generated or used.</p><h2>{project.title}</h2><p>{project.audioDurationSeconds}s · {project.bpmEstimate} BPM · {project.status}</p><div className="cinex-scene-list">{project.storyboard.map((shot) => <article className="cinex-scene-card" key={shot.id}><div className="cinex-scene-card-header"><strong>{shot.order}. {shot.section}</strong><span>{shot.status}</span></div><p>{shot.title}</p><p>{shot.purpose}</p></article>)}</div><div className="cinex-dashboard-actions"><Link href={`/music-video/storyboard?project=${encodeURIComponent(project.id)}`} className="cinex-route-primary">Edit storyboard</Link><Link href="/music-video/new" className="cinex-auth-secondary">Create another project</Link><Link href="/dashboard" className="cinex-route-secondary-link">Go to dashboard</Link></div></section> : <div className="cinex-auth-required">We couldn&apos;t find that music project. <Link href="/music-video" className="cinex-route-secondary-link">Back to Music Video Studio</Link></div>}</CinexRoutePage>;
}
