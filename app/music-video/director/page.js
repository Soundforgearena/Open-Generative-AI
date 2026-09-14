'use client';

import { Suspense } from 'react';
import DirectorWorkspace from '@/components/director/DirectorWorkspace';

export default function MusicVideoDirectorPage() {
  return (
    <Suspense fallback={<main>Loading Music Video Director workspace...</main>}>
      <DirectorWorkspace initialLane="music_video" allowLaneSwitch={false} />
    </Suspense>
  );
}
