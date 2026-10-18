import { guard, insertRows, selectRows, safeError } from '../../../lib/cinexvideo-server';
import { EMOTION_KEYS, cameraFor, emotionNote } from '../../../lib/director/emotion';
import { serializeShotDirection } from '../../../lib/studio/studio-model';

/** List the signed-in user's projects. */
export async function GET(request) {
  const { user, error } = await guard(request);
  if (error) return error;
  const projects = await selectRows(
    'projects',
    { owner_id: `eq.${user.id}`, order: 'updated_at.desc', limit: 50 },
    'id,lane,title,logline,status,updated_at'
  );
  return Response.json({ projects });
}

/**
 * Create a project. When an AI Director plan is supplied the whole production
 * bible is persisted in one shot: scenes, characters, outfits and locations.
 */
export async function POST(request) {
  const { user, error } = await guard(request, { blockOnMaintenance: true });
  if (error) return error;
  try {
    const body = await request.json();
    const lane = body.lane === 'music_video' ? 'music_video' : 'episode';
    const plan = body.plan || null;

    const created = await insertRows('projects', {
      owner_id: user.id,
      lane,
      title: plan?.creative_title || body.title || 'Untitled project',
      logline: plan?.logline || null,
      visual_identity: plan?.visual_identity || {},
      director_plan: plan,
      status: plan ? 'in_production' : 'draft',
    });
    if (!created.ok || !created.data?.[0]) return safeError('Project could not be created.', 500);
    const project = created.data[0];

    if (plan?.scenes?.length) {
      await insertRows(
        'scenes',
        plan.scenes.slice(0, 60).map((scene, index) => ({
          project_id: project.id,
          position: index + 1,
          title: scene.title || `Scene ${index + 1}`,
          purpose: EMOTION_KEYS.includes(scene.emotion)
            ? `${emotionNote({ emotion: scene.emotion, intensity: Math.min(10, Math.max(1, Number(scene.intensity) || 6)), why: '' })} ${scene.viewer_feeling ? `${String(scene.viewer_feeling).slice(0, 300)} ` : ''}${scene.purpose || ''}`.trim().slice(0, 5000)
            : scene.purpose || null,
          duration_seconds: Math.min(Math.max(Number(scene.duration_seconds) || 8, 1), 600),
          // The Director's emotional read becomes structured shot settings
          // (feeling, strength and the camera that suits it); its own
          // written direction is kept as notes.
          shot_direction: EMOTION_KEYS.includes(scene.emotion)
            ? serializeShotDirection({
              ...cameraFor(scene.emotion, { sung: false }),
              emotion: scene.emotion,
              intensity: Number(scene.intensity) || 6,
              notes: String(scene.shot_direction || '').slice(0, 2000),
            })
            : scene.shot_direction || null,
          prompt: scene.prompt || null,
        }))
      );
    }

    const assets = [
      ...(plan?.characters || []).map((name) => ({ kind: 'character', name })),
      ...(plan?.outfits || []).map((name) => ({ kind: 'outfit', name })),
      ...(plan?.locations || []).map((name) => ({ kind: 'location', name })),
    ]
      .filter((asset) => asset.name)
      .slice(0, 60)
      .map((asset) => ({ ...asset, project_id: project.id }));
    if (assets.length) await insertRows('project_assets', assets);

    return Response.json({ project_id: project.id }, { status: 201 });
  } catch (err) {
    console.error('projects route', err);
    return safeError('Project could not be created.', 500);
  }
}
