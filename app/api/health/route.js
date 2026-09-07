export async function GET() {
  return Response.json({
    ok: true,
    service: 'cinexvideo',
    revision:
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.RAILWAY_DEPLOYMENT_ID ||
      'local',
    timestamp: new Date().toISOString(),
  });
}
