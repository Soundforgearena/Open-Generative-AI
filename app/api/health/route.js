import { execFile } from 'node:child_process';

export const dynamic = 'force-dynamic';

// Checked once per server start: can this server render finished videos?
let rendererCheck = null;
function rendererReady() {
  if (!rendererCheck) {
    rendererCheck = new Promise((resolve) => {
      execFile('ffmpeg', ['-version'], { timeout: 5000 }, (error) => resolve(!error));
    });
  }
  return rendererCheck;
}

export async function GET() {
  return Response.json({
    ok: true,
    service: 'cinexvideo',
    revision:
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.RAILWAY_DEPLOYMENT_ID ||
      'local',
    video_renderer: (await rendererReady()) ? 'ready' : 'missing',
    timestamp: new Date().toISOString(),
  });
}
