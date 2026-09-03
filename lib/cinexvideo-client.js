const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export async function signInWithPassword(email, password) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!response.ok) throw new Error('Sign-in failed');
  const session = await response.json();
  if (typeof window !== 'undefined') window.localStorage.setItem('cinexvideo_session', JSON.stringify(session));
  return session;
}

export function getStoredSession() {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem('cinexvideo_session');
  return raw ? JSON.parse(raw) : null;
}

export async function requestDirectorPlan(prompt) {
  const session = getStoredSession();
  if (!session?.access_token) throw new Error('Please sign in to use the AI Director.');
  const response = await fetch('/api/director', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ prompt }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Director request failed.');
  return data.plan;
}

export async function requestGeneration(payload) {
  const session = getStoredSession();
  if (!session?.access_token) throw new Error('Please sign in to generate.');
  const response = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Generation could not be started.');
  return data;
}

export async function pollJob(requestId) {
  const session = getStoredSession();
  if (!session?.access_token) throw new Error('Please sign in to check status.');
  const response = await fetch(`/api/jobs/${requestId}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Status check failed.');
  return data;
}
