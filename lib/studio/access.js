// Who may see or change a project. Every user's projects are their own:
// - only the owner can change anything (edit, generate, upload, delete);
// - the super admin may open a project read-only, for support;
// - other admins have no access to anyone else's work.

export function canRead(project, { user, superAdmin = false } = {}) {
  return Boolean(project && user && (project.owner_id === user.id || superAdmin === true));
}

export function canWrite(project, { user } = {}) {
  return Boolean(project && user && project.owner_id === user.id);
}

// True when the copy a save was based on is older than what is stored now.
export function isStale(current, base) {
  if (!base || !current) return false;
  const a = Date.parse(current);
  const b = Date.parse(base);
  return Number.isFinite(a) && Number.isFinite(b) && a > b;
}
