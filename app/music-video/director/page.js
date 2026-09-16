'use client';

import { Suspense } from 'react';
import DirectorWorkspace from '@/components/director/DirectorWorkspace';

export default function MusicVideoDirectorPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-950 px-4 py-12 text-center text-sm text-slate-300">Loading music-video director workspace...</main>}>
      <DirectorWorkspace initialLane="music_video" />
    </Suspense>
  );
}
