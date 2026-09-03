import {
  guard,
  callRpc,
  selectOne,
  insertRows,
  updateRows,
  safeError,
} from '../../../lib/cinexvideo-server';

const EXPORT_TYPES = ['watermarked', 'clean', 'storyboard'];

// Paid exports are switched off until the render worker exists. Nothing
// currently writes export_jobs.output_path, so charging credits for a clean
// export or a storyboard pack would take payment for a file we cannot deliver.
// Flip this to false once the worker ships.
const PAID_EXPORTS_DISABLED = process.env.ENABLE_PAID_EXPORTS !== 'true';
const PAID_EXPORT_TYPES = ['clean', 'storyboard'];

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
    if (PAID_EXPORTS_DISABLED && PAID_EXPORT_TYPES.includes(exportType)) {
      return safeError(
        'Final delivery is coming soon. Watermarked exports are available now and your credits stay untouched.',
        503
      );
    }
    if (!projectId) return safeError('Export details are incomplete.');

    const project = await selectOne('projects', { id: `eq.${projectId}` }, 'id,owner_id,title');
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

    const job = await insertRows('export_jobs', {
      user_id: user.id,
      project_id: projectId,
      export_type: exportType,
      resolution,
      format,
      status: 'queued',
      credits_reserved: credits,
    });

    if (!job.ok) {
      if (credits > 0) {
        await callRpc('release_credits', {
          p_user_id: user.id,
          p_credits: credits,
          p_reference_id: reference,
        });
      }
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
        export_job_id: job.data?.[0]?.id || null,
        credits_charged: credits,
        watermarked: exportType !== 'clean',
        status: 'queued',
      },
      { status: 202 }
    );
  } catch (err) {
    console.error('exports route', err);
    return safeError('Export could not be queued.', 500);
  }
}
