import { safeError } from '../../../lib/cinexvideo-server';

/**
 * Retired. Exports used to write files into storage; the finished video is now
 * rendered on demand and streamed straight to the user's device, Google Drive
 * or Dropbox (POST /api/exports/video), so exports never use app storage.
 */
export async function POST() {
  return safeError('Use Download in the studio to get your finished video.', 410);
}
