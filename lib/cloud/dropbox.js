'use client';

// Save finished videos to the user's own Dropbox.
//
// Uses Dropbox's secure browser sign-in (OAuth with PKCE, no server secret).
// The app only gets its own folder, Dropbox › Apps › CineXVideo, and the
// video uploads straight from this device. The connection is remembered on
// this device only and can be disconnected at any time.

const STORE_KEY = 'cinex-dropbox-v1';
const PENDING_KEY = 'cinex-dropbox-pending-v1';
const CHUNK = 8 * 1024 * 1024;
const SINGLE_LIMIT = 140 * 1024 * 1024;

export const dropboxAppKey = process.env.NEXT_PUBLIC_DROPBOX_APP_KEY || '';
export const dropboxAvailable = Boolean(dropboxAppKey);

const redirectUri = () => `${window.location.origin}/auth/dropbox`;

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function read() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { return null; }
}
function write(value) {
  try { if (value) localStorage.setItem(STORE_KEY, JSON.stringify(value)); else localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
}

export function dropboxConnected() {
  return Boolean(read()?.refresh_token);
}

export async function disconnectDropbox() {
  const saved = read();
  write(null);
  if (saved?.access_token) {
    fetch('https://api.dropboxapi.com/2/auth/token/revoke', { method: 'POST', headers: { Authorization: `Bearer ${saved.access_token}` } }).catch(() => {});
  }
}

async function tokenRequest(params) {
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: dropboxAppKey, ...params }),
  });
  if (!res.ok) throw new Error('Dropbox could not be connected. Please try again.');
  return res.json();
}

/** Opens Dropbox sign-in in a popup. Call from a click. */
export async function connectDropbox() {
  if (!dropboxAvailable) throw new Error('Dropbox is not set up yet.');
  // Open the window synchronously inside the click so it is never blocked.
  const popup = window.open('about:blank', 'cinex-dropbox', 'width=560,height=720');
  if (!popup) throw new Error('Allow popups for this site to connect Dropbox.');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state })); } catch { /* ignore */ }
  const url = new URL('https://www.dropbox.com/oauth2/authorize');
  Object.entries({
    client_id: dropboxAppKey,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri(),
    token_access_type: 'offline',
    state,
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  popup.location.href = url.toString();

  const code = await new Promise((resolve, reject) => {
    const timer = window.setInterval(() => {
      if (popup.closed) { cleanup(); reject(new Error('The Dropbox window was closed before connecting.')); }
    }, 600);
    function onMessage(event) {
      if (event.origin !== window.location.origin || event.data?.type !== 'cinex-dropbox') return;
      cleanup();
      if (event.data.error || event.data.state !== state) reject(new Error('Dropbox access was not allowed.'));
      else resolve(event.data.code);
    }
    function cleanup() { window.clearInterval(timer); window.removeEventListener('message', onMessage); }
    window.addEventListener('message', onMessage);
  });

  const token = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri(), code_verifier: verifier });
  write({ access_token: token.access_token, refresh_token: token.refresh_token, expires: Date.now() + Number(token.expires_in || 14400) * 1000 });
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
  return true;
}

async function accessToken() {
  const saved = read();
  if (!saved?.refresh_token) throw new Error('Connect Dropbox first.');
  if (saved.access_token && saved.expires > Date.now() + 60_000) return saved.access_token;
  const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: saved.refresh_token }).catch(() => null);
  if (!fresh?.access_token) { write(null); throw new Error('Your Dropbox connection expired. Connect again and retry.'); }
  write({ ...saved, access_token: fresh.access_token, expires: Date.now() + Number(fresh.expires_in || 14400) * 1000 });
  return fresh.access_token;
}

// Dropbox-API-Arg must be ASCII; escape everything else.
const apiArg = (value) => JSON.stringify(value).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

async function content(token, endpoint, arg, body) {
  const res = await fetch(`https://content.dropboxapi.com/2/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': apiArg(arg) },
    body,
  });
  if (res.status === 401) { write(null); throw new Error('Your Dropbox connection expired. Connect again and retry.'); }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text.includes('insufficient_space') ? 'Your Dropbox is full. Free up space and try again.' : 'Dropbox did not accept the upload. Please try again.');
  }
  return res.json().catch(() => ({}));
}

/** Upload into Dropbox › Apps › CineXVideo. Returns { link }. */
export async function uploadToDropbox(blob, name, { onProgress } = {}) {
  const token = await accessToken();
  const path = `/${name}`;
  const commit = { path, mode: 'add', autorename: true, mute: false };
  if (blob.size <= SINGLE_LIMIT) {
    onProgress?.(0.05);
    await content(token, 'files/upload', commit, blob);
    onProgress?.(1);
  } else {
    const start = await content(token, 'files/upload_session/start', { close: false }, blob.slice(0, CHUNK));
    let offset = CHUNK;
    while (offset < blob.size) {
      const end = Math.min(blob.size, offset + CHUNK);
      const cursor = { session_id: start.session_id, offset };
      if (end >= blob.size) await content(token, 'files/upload_session/finish', { cursor, commit }, blob.slice(offset, end));
      else await content(token, 'files/upload_session/append_v2', { cursor, close: false }, blob.slice(offset, end));
      offset = end;
      onProgress?.(offset / blob.size);
    }
  }
  return { link: 'https://www.dropbox.com/home/Apps/CineXVideo' };
}
