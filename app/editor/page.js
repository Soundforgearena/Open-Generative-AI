'use client';

import { Suspense } from 'react';
import DirectorWorkspace from '@/components/director/DirectorWorkspace';

export default function EditorPage() {
  return (
    <Suspense fallback={<main>Loading Director workspace...</main>}>
      <DirectorWorkspace initialLane="music_video" allowLaneSwitch />
    </Suspense>
  );
}
