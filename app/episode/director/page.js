'use client';

import { Suspense } from 'react';
import DirectorWorkspace from '@/components/director/DirectorWorkspace';

export default function EpisodeDirectorPage() {
  return (
    <Suspense fallback={<main>Loading Episode Director workspace...</main>}>
      <DirectorWorkspace initialLane="episode" allowLaneSwitch={false} />
    </Suspense>
  );
}
