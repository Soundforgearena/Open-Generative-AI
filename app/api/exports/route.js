import {
  guard,
  callRpc,
  selectOne,
  selectRows,
  createSignedUploadUrl,
  createSignedDownloadUrl,
  updateRows,
  safeError,
} from '../../../lib/cinexvideo-server';
import { buildExportArtifact } from '../../../lib/exports/export-artifacts.js';

const EXPORT_TYPES = ['watermarked', 'clean', 'storyboard'];

async function uploadArtifact({ userId, exportType, extension, contentType, content }) {
  const path = `exports/${userId}/${Date.now()}-${crypto.randomUUID()}-${exportType}.${extension}`;
  const uploadUrl = await createSignedUploadUrl('cinexvideo-references', path);
  if (!uploadUrl) throw new Error('signed upload failed');
  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: content,
  });
  if (!upload.ok) throw new Error('artifact upload failed');
  const downloadUrl = await createSignedDownloadUrl('cinexvideo-references', path, 24 * 60 * 60);
  if (!downloadUrl) throw new Error('signed download failed');
  return { path, downloadUrl };
}

/**
 * Quote an export. Watermarked delivery is included with a paid generation;
 * clean delivery and storyboard packs consume credits. The customer only ever
 * sees the credit figure — never provider cost, overhead or the margin floor.
 */
export async function POST(request) {
  const { user, admin, error } = await guard(request, { blockOnMaintenance: true });
  if (error) return error;
  try {
    const body = await request.json();
    const {
      project_id: projectId,
      export_type: exportType = 'watermarked',
      resolution = '1080p',
      format = 'mp4',
      confirm = false,
    } = body;

    if (!EXPORT_TYPES.includes(exportType)) return safeError('That export option is not available.');
    if (!projectId) return safeError('Export details are incomplete.');

    const project = await selectOne('projects', { id: `eq.${projectId}` }, 'id,owner_id,title,logline');
    if (!project || (project.owner_id !== user.id && !admin)) return safeError('Project not found.', 404);

    const quote = await callRpc('customer_export_quote', {
      p_export_type: exportType,
      p_resolution: resolution,
      p_format: format,
    });
    const row = Array.isArray(quote.data) ? quote.data[0] : quote.data;
    if (!quote.ok || !row) return safeError('This export option is temporarily unavailable.', 409);

    const credits = Number(row.credits ?? row.credits_required ?? 0);

    // Quote-only pass so the UI can show the cost before the user commits.
    if (!confirm) {
      return Response.json({
        export_type: exportType,
        credits_required: credits,
        watermarked: exportType === 'watermarked',
      });
    }

    const reference = crypto.randomUUID();
    const scenes = await selectRows(
      'scenes',
      { project_id: `eq.${projectId}`, order: 'position.asc' },
      'id,position,title,purpose,prompt,duration_seconds,status,active_version'
    );
    const sceneIds = scenes.map((scene) => scene.id).filter(Boolean);
    const sceneVersions = sceneIds.length
      ? await selectRows(
        'scene_versions',
        {
          scene_id: `in.(${sceneIds.join(',')})`,
          status: 'eq.completed',
          order: 'scene_id.asc,version.desc',
        },
        'scene_id,version,output_url,approved'
      )
      : [];
    const artifact = buildExportArtifact({
      exportType,
      project,
      scenes,
      sceneVersions: exportType === 'storyboard'
        ? sceneVersions
        : sceneVersions.filter((version) => version.approved || exportType === 'watermarked'),
    });
    if (!artifact) return safeError('This project has no completed scenes ready for export yet.', 409);

    if (credits > 0) {
      const reserved = await callRpc('reserve_credits', {
        p_user_id: user.id,
        p_credits: credits,
        p_reference_id: reference,
      });
      if (!reserved.ok || reserved.data !== true) {
        return safeError('You need more credits to continue.', 402);
      }
    }

    let uploaded;
    try {
      uploaded = await uploadArtifact({
        userId: user.id,
        exportType,
        extension: artifact.extension,
        contentType: artifact.contentType,
        content: artifact.content,
      });
    } catch (uploadError) {
      if (credits > 0) {
        await callRpc('release_credits', {
          p_user_id: user.id,
          p_credits: credits,
          p_reference_id: reference,
        });
      }
      console.error('exports upload', uploadError);
      return safeError('Export could not be queued.', 500);
    }

    if (credits > 0) {
      await callRpc('consume_credits', {
        p_user_id: user.id,
        p_credits: credits,
        p_reference_id: reference,
      });
    }

    await updateRows('projects', { id: `eq.${projectId}` }, { status: 'delivered' });

    return Response.json(
      {
        export_job_id: reference,
        credits_charged: credits,
        watermarked: exportType !== 'clean',
        status: 'completed',
        output_path: uploaded.path,
        download_url: uploaded.downloadUrl,
        artifact_format: artifact.extension,
        ...artifact.summary,
      },
      { status: 202 }
    );
  } catch (err) {
    console.error('exports route', err);
    return safeError('Export could not be queued.', 500);
  }
}
