'use client';

// Save finished videos to the user's own Google Drive.
//
// Runs entirely in the browser: the user signs in with Google in a popup,
// grants access to files CineXVideo creates (drive.file, nothing else in their
// Drive), and the video uploads straight from this device into a
// "CineXVideo" folder. No tokens or videos are stored on our servers.

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_KEY = 'cinex-gdrive-token-v1';
const FOLDER_NAME = 'CineXVideo';

export const googleDriveClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
export const googleDriveAvailable = Boolean(googleDriveClientId);

let scriptPromise = null;
function loadScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = 'https://accounts.google.com/gsi/client';
      tag.async = true;
      tag.onload = () => resolve();
      tag.onerror = () => { scriptPromise = null; reject(new Error('Google sign-in could not load. Check your connection and try again.')); };
      document.head.appendChild(tag);
    });
  }
  return scriptPromise;
}

/** Load Google's script early so the Connect click opens the popup instantly. */
export function preloadGoogleDrive() {
  if (googleDriveAvailable && typeof window !== 'undefined') loadScript().catch(() => {});
}

function savedToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
    return t && t.expires > Date.now() + 60_000 ? t : null;
  } catch {
    return null;
  }
}

export function googleDriveConnected() {
  return Boolean(savedToken());
}

export function disconnectGoogleDrive() {
  const t = savedToken();
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t.access_token, () => {});
}

/** Opens Google's consent popup. Call from a click. Resolves when connected. */
export async function connectGoogleDrive() {
  if (!googleDriveAvailable) throw new Error('Google Drive is not set up yet.');
  await loadScript();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: googleDriveClientId,
      scope: SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error === 'access_denied' ? 'Google Drive access was not allowed.' : 'Google Drive could not be connected.'));
          return;
        }
        const token = { access_token: response.access_token, expires: Date.now() + Number(response.expires_in || 3600) * 1000 };
        try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token)); } catch { /* ignore */ }
        resolve(token);
      },
      error_callback: (err) => reject(new Error(err?.type === 'popup_closed' ? 'The Google window was closed before connecting.' : 'Google Drive could not be connected. Allow popups for this site and try again.')),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

async function driveFetch(token, url, options = {}) {
  const res = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  if (res.status === 401) {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    throw new Error('Your Google Drive connection expired. Connect again and retry.');
  }
  if (!res.ok) throw new Error('Google Drive did not accept the upload. Check you have enough Drive storage.');
  return res;
}

async function folderId(token) {
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = await (await driveFetch(token, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`)).json();
  if (found.files?.[0]?.id) return found.files[0].id;
  const created = await (await driveFetch(token, 'https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  })).json();
  return created.id;
}

function putWithProgress(url, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', blob.type || 'video/mp4');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(JSON.parse(xhr.responseText || '{}')) : reject(new Error('Google Drive upload failed. Please try again.')));
    xhr.onerror = () => reject(new Error('The connection dropped while uploading to Google Drive.'));
    xhr.send(blob);
  });
}

/** Upload into My Drive › CineXVideo. Returns { link }. */
export async function uploadToGoogleDrive(blob, name, { onProgress } = {}) {
  const token = savedToken()?.access_token;
  if (!token) throw new Error('Connect Google Drive first.');
  const parent = await folderId(token);
  const start = await driveFetch(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': blob.type || 'video/mp4', 'X-Upload-Content-Length': String(blob.size) },
    body: JSON.stringify({ name, parents: [parent], description: 'Made with CineXVideo' }),
  });
  const location = start.headers.get('location');
  if (!location) throw new Error('Google Drive did not start the upload. Please try again.');
  const file = await putWithProgress(location, blob, onProgress);
  return { link: file.webViewLink || 'https://drive.google.com/drive/my-drive' };
}
