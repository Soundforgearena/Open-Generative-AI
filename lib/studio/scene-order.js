// Pure ordering helpers for scene create / duplicate / delete / reorder.

export const MAX_SCENES = 60;

/** Returns ids in their new order after moving `id` to `toIndex`. */
export function moveId(ids, id, toIndex) {
  const from = ids.indexOf(id);
  if (from < 0) return ids.slice();
  const next = ids.slice();
  next.splice(from, 1);
  const clamped = Math.max(0, Math.min(next.length, Math.round(Number(toIndex) || 0)));
  next.splice(clamped, 0, id);
  return next;
}

/** Sanitised fields for a new scene row. */
export function newSceneFields(input = {}, fallbackTitle = 'New scene') {
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 200) : fallbackTitle;
  const duration = Math.min(Math.max(Math.round(Number(input.duration_seconds) || 8), 1), 600);
  return {
    title,
    purpose: typeof input.purpose === 'string' ? input.purpose.slice(0, 5000) : '',
    prompt: typeof input.prompt === 'string' ? input.prompt.slice(0, 5000) : '',
    shot_direction: typeof input.shot_direction === 'string' ? input.shot_direction.slice(0, 5000) : null,
    duration_seconds: duration,
    continuity_locked: false,
    status: 'draft',
  };
}
