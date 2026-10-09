// Drops async results after unmount or after the key they were started for changes.
export function createStaleGuard(getKey) {
  let alive = false;
  let generation = 0;
  return {
    start() { alive = true; },
    stop() { alive = false; generation += 1; },
    invalidate() { generation += 1; },
    capture() {
      const key = getKey();
      const capturedGeneration = generation;
      return () => alive && generation === capturedGeneration && getKey() === key;
    },
  };
}
