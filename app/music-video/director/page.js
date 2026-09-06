'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import CinexRoutePage from '@/components/CinexRoutePage';
import AskAiDirectorButton from '@/components/AskAiDirectorButton';
import { demoModeEnabled } from '@/lib/demo-mode';
import { getMusicProject, saveMusicProject } from '@/lib/music-video-demo';
import { createMusicVideoTreatment } from '@/lib/music-video-director';

function DirectorContent() {
  const params = useSearchParams();
  const [project, setProject] = useState(null);
  const [treatment, setTreatment] = useState(null);
  const [message, setMessage] = useState('Loading music project...');
  useEffect(() => { const next = demoModeEnabled ? getMusicProject(params.get('project')) : null; if (!next) { setMessage('Music project not found.'); return; } setProject(next); setTreatment(next.directorTreatment || createMusicVideoTreatment(next)); }, [params]);
  if (!project) return <CinexRoutePage eyebrow="Music Video Director" title="Director workspace" description={message}><Link href="/music-video" className="cinex-route-primary">Back to Music Video Studio</Link></CinexRoutePage>;
  function saveTreatment(next) { const updated = { ...project, directorTreatment: next }; setProject(updated); saveMusicProject(updated); }
  return <CinexRoutePage eyebrow="Music Video Director" title="Shape the music video" description="A creative AI persona for music-video concepts, performance, narrative, and visual direction.">
    <p className="cinex-demo-indicator">Demo Director preview — suggestions are generated locally. No model call, audio processing, video generation, or credits are used.</p>
    <div className="cinex-music-project-summary"><strong>{project.title}</strong><span>{project.audioDurationSeconds}s · {project.bpmEstimate} BPM · {project.lyricsMode}</span><span>{project.videoStyle} · {project.aspectRatio}</span></div>
    <div className="cinex-director-room">
      {treatment && <section className="cinex-shot-plan"><p className="cinex-shot-plan-eyebrow">Music Video Treatment</p><h2>{treatment.logline}</h2><div className="cinex-treatment-grid">{Object.entries(treatment).filter(([key]) => !['concepts', 'structure'].includes(key)).map(([key, value]) => <article key={key}><strong>{key.replace(/[A-Z]/g, (letter) => ` ${letter}`).toUpperCase()}</strong><p>{typeof value === 'string' ? value : JSON.stringify(value)}</p></article>)}</div><AskAiDirectorButton fieldType="story" value={treatment.coreConcept} context={{ sourceType: 'music-video', style: project.videoStyle, duration: project.audioDurationSeconds }} onApply={(suggestion) => saveTreatment({ ...treatment, coreConcept: suggestion })} /><button type="button" className="cinex-route-primary" onClick={() => { const updated = { ...project, directorTreatment: treatment }; saveMusicProject(updated); window.location.href = `/music-video/storyboard?project=${encodeURIComponent(project.id)}`; }}>Continue to Storyboard</button></section>}
    </div>
    <Link href={`/music-video/review?project=${encodeURIComponent(project.id)}`} className="cinex-route-secondary-link">Go to Review</Link>
  </CinexRoutePage>;
}
export default function MusicVideoDirectorPage() { return <Suspense fallback={<main className="cinex-dashboard-loading">Loading Director workspace...</main>}><DirectorContent /></Suspense>; }
