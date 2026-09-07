export function safeInternalPath(value, fallback = '/') {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    /^\/[a-z][a-z\d+.-]*:/i.test(value)
  ) return fallback;
  return value;
}

export function safeProjectId(value, demoMode = false) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const demoId = /^demo-project-[a-z0-9-]+$/i;
  return uuid.test(value || '') || (demoMode && demoId.test(value || ''));
}
