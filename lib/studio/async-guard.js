// Drops async results that resolve after the component unmounted or after the
// key they were started for (project id, scene id) changed.

export function createStaleGuard(getKey) {
  let alive = false;
  return {
    start() { alive = true; },
    stop() { alive = false; },
    /** Returns a function that is true only while the captured key is still current. */
    capture() {
      const key = getKey();
      return () => alive && getKey() === key;
    },
  };
}
