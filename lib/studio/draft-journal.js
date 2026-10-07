// Local safety net for studio edits.
//
// Every edit is written to localStorage immediately (synchronously), before
// the debounced autosave reaches the server. If the page is refreshed, closed
// or crashes in between, the next load replays the edits that never made it
// to the server. Entries older than the server copy are discarded, so a stale
// tab can never overwrite newer work from another device.

const PREFIX = 'cinex-studio-draft-v1:';
const UI_PREFIX = 'cinex-studio-ui-v1:';
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function store(kind = 'local') {
  try {
    return typeof window === 'undefined' ? null : kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function read(key, kind) {
  try {
    return JSON.parse(store(kind)?.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function write(key, value, kind) {
  try {
    if (value === null) store(kind)?.removeItem(key);
    else store(kind)?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or private mode: the server autosave still runs */
  }
}

/** Write the full set of unsaved edits for a project. */
export function writeJournal(projectId, { scenes = {}, project = null } = {}) {
  if (!projectId) return;
  const hasScenes = Object.keys(scenes).length > 0;
  if (!hasScenes && !project) { write(PREFIX + projectId, null); return; }
  write(PREFIX + projectId, { at: Date.now(), scenes, project });
}

export function clearJournal(projectId) {
  if (projectId) write(PREFIX + projectId, null);
}

/**
 * Unsaved edits to replay for a project, filtered against the server copy.
 * `serverScenes` are rows with `id` and `updated_at`; `serverProjectUpdatedAt`
 * is the project's `updated_at`.
 */
export function pendingJournal(projectId, serverScenes = [], serverProjectUpdatedAt = null, now = Date.now()) {
  const entry = read(PREFIX + projectId);
  if (!entry || typeof entry !== 'object' || !entry.at || now - entry.at > MAX_AGE_MS) return null;
  const known = new Map(serverScenes.map((s) => [s.id, s.updated_at ? Date.parse(s.updated_at) : 0]));
  const scenes = {};
  for (const [id, patch] of Object.entries(entry.scenes || {})) {
    if (!known.has(id)) continue; // scene was deleted
    if ((known.get(id) || 0) > entry.at) continue; // server copy is newer
    if (patch && typeof patch === 'object' && Object.keys(patch).length) scenes[id] = patch;
  }
  const projectNewer = serverProjectUpdatedAt && Date.parse(serverProjectUpdatedAt) > entry.at;
  const project = entry.project && !projectNewer ? entry.project : null;
  if (!Object.keys(scenes).length && !project) return null;
  return { scenes, project, at: entry.at };
}

/** Per-tab UI state (selected scene, panels) so a refresh lands in the same place. */
export function readUiState(projectId) {
  return (projectId && read(UI_PREFIX + projectId, 'session')) || {};
}

export function writeUiState(projectId, state) {
  if (projectId) write(UI_PREFIX + projectId, state, 'session');
}
