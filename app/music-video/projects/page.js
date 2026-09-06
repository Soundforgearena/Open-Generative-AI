'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import CinexRoutePage from '@/components/CinexRoutePage';
import { demoModeEnabled } from '@/lib/demo-mode';
import { listMusicProjects } from '@/lib/music-video-demo';

export default function MusicProjectsPage() {
  const [projects, setProjects] = useState([]);
  useEffect(() => { if (demoModeEnabled) setProjects(listMusicProjects()); }, []);
  return <CinexRoutePage eyebrow="Music Video Studio" title="Music projects" description="Review local music-video plans without uploading audio or calling providers.">{demoModeEnabled && <p className="cinex-demo-indicator">Demo Music Video Studio — local planning only.</p>}<div className="cinex-template-grid">{projects.map((project) => <Link key={project.id} href={`/music-video/projects/${encodeURIComponent(project.id)}`} className="cinex-template-card"><span>{project.status} · {project.audioDurationSeconds}s</span><strong>{project.title}</strong><small>{project.lyricsMode} · {project.storyboard?.length || 0} shots</small><em>Open project</em></Link>)}</div>{projects.length === 0 && <div className="cinex-auth-required">No music-video projects yet. <Link href="/music-video/new" className="cinex-route-secondary-link">Start a music-video plan</Link></div>}</CinexRoutePage>;
}
