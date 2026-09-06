export const DEMO_PROJECTS_KEY = 'cinexvideo_demo_projects_v1';

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function readProjects() {
  if (!canUseStorage()) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DEMO_PROJECTS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeProjects(projects) {
  if (!canUseStorage()) return false;
  try {
    window.localStorage.setItem(DEMO_PROJECTS_KEY, JSON.stringify(projects));
    return true;
  } catch {
    return false;
  }
}

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `demo-project-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function listDemoProjects() {
  return readProjects();
}

export function getDemoProject(id) {
  return readProjects().find((project) => project.id === id) || null;
}

export function saveDemoProject(project) {
  const projects = readProjects();
  const next = { ...project, updatedAt: new Date().toISOString() };
  const index = projects.findIndex((item) => item.id === next.id);
  if (index >= 0) projects[index] = next;
  else projects.unshift(next);
  writeProjects(projects);
  return next;
}

export function createDemoProject(input) {
  const now = new Date().toISOString();
  return saveDemoProject({
    id: makeId(),
    title: input.title,
    sourceType: input.sourceType,
    sourceText: input.sourceText,
    notes: input.notes || '',
    style: input.style,
    aspectRatio: input.aspectRatio,
    duration: Number(input.duration),
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    scenes: input.scenes || [],
  });
}

export function deleteDemoProject(id) {
  writeProjects(readProjects().filter((project) => project.id !== id));
}

export function resetDemoProjects() {
  if (canUseStorage()) window.localStorage.removeItem(DEMO_PROJECTS_KEY);
}
