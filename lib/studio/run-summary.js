// The message shown after making stills or takes. Plain wording for every
// mix of ready, blocked (content check) and failed scenes.

const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * kind: 'still' | 'take'. made: finished scenes. blocked: scenes stopped by
 * the content check (their window explains why). failed: other failures
 * (always refunded).
 */
export function runSummary({ kind = 'still', made = 0, blocked = 0, failed = 0 }) {
  const thing = kind === 'still' ? ['still', 'stills'] : ['new take', 'new takes'];
  const next = kind === 'still' ? 'Check the face and framing, then approve before animating.' : `Review ${made === 1 ? 'it' : 'them'} in the scene.`;
  const parts = [];
  if (made) parts.push(`${made === 1 ? (kind === 'still' ? 'Still' : 'New take') : `${made} ${thing[1]}`} ready.`);
  if (blocked) {
    parts.push(blocked === 1
      ? `${made ? 'One scene' : 'This scene'} needs a change to fit our content policy, so it wasn't made and nothing was charged. A safe version is waiting for you to review.`
      : `${blocked} scenes need a change to fit our content policy, so they weren't made and nothing was charged. Safe versions are waiting for you to review.`);
  }
  if (failed) {
    parts.push(`${n(failed, 'scene', 'scenes')} couldn't be ${kind === 'still' ? 'made' : 'finished'} this time. Your credits for ${failed === 1 ? 'it were' : 'them were'} returned; try ${failed === 1 ? 'it' : 'them'} again.`);
  }
  if (made) parts.push(next);
  if (!parts.length) return kind === 'still' ? 'Nothing was made.' : 'Generation complete.';
  return parts.join(' ');
}
