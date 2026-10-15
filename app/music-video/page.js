import Link from 'next/link';
import CinexRoutePage from '@/components/CinexRoutePage';
import { demoModeEnabled } from '@/lib/demo-mode';

const cards = [
  ['Upload My Song', 'Upload your track. Every scene is timed to it and sung lines are lip-synced.', '/music-video/new'],
  ['Start With Lyrics', 'Paste your lyrics with singer tags. Each line is timed to the vocal.', '/music-video/new?lyrics=official'],
  ['Make an Instrumental Visual', 'Let energy and sections guide an abstract visual plan.', '/music-video/new?lyrics=instrumental'],
  ['Import an Authorized Track', 'Use only music you created or are authorized to use.', '/music-video/new?source=authorized-import'],
  ['Let AI Director Pitch a Concept', 'Describe the vibe and let the AI Director shape the treatment.', '/music-video/new?director=1'],
];

export default function MusicVideoPage() {
  return <CinexRoutePage eyebrow="CineXVideo music department" title="Music Video Studio" description="Turn your song into a cinematic music video—guided by AI Director, scene by scene and beat by beat.">
    {demoModeEnabled && <p className="cinex-demo-indicator">Demo Music Video Studio — local planning only. No audio is uploaded, transcribed, generated, or sent to a provider.</p>}
    <div className="cinex-music-card-grid">{cards.map(([title, description, href]) => <Link key={title} href={href} className="cinex-music-card"><strong>{title}</strong><span>{description}</span><em>Open workflow</em></Link>)}</div>
    <Link href="/music-video/projects" className="cinex-route-secondary-link">View music-video projects</Link>
  </CinexRoutePage>;
}
