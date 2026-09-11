function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function preferredVersion(versions = []) {
  return [...versions].sort((a, b) => Number(b.version || 0) - Number(a.version || 0))[0] || null;
}

export function buildExportArtifact({ exportType, project, scenes, sceneVersions = [] }) {
  const versionsByScene = sceneVersions.reduce((map, version) => {
    if (!map.has(version.scene_id)) map.set(version.scene_id, []);
    map.get(version.scene_id).push(version);
    return map;
  }, new Map());

  const orderedScenes = [...scenes].sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  const scenePayload = orderedScenes.map((scene) => {
    const selectedVersion = preferredVersion(versionsByScene.get(scene.id) || []);
    return {
      id: scene.id,
      position: scene.position,
      title: scene.title,
      purpose: scene.purpose,
      prompt: scene.prompt,
      duration_seconds: scene.duration_seconds,
      status: scene.status,
      active_version: scene.active_version,
      output_url: selectedVersion?.output_url || null,
      version: selectedVersion?.version || null,
      approved: Boolean(selectedVersion?.approved),
    };
  });

  if (exportType === 'storyboard') {
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(project.title || 'Storyboard export')}</title>
  </head>
  <body>
    <h1>${escapeHtml(project.title || 'Storyboard export')}</h1>
    <p>${escapeHtml(project.logline || '')}</p>
    <ol>
      ${scenePayload.map((scene) => `<li>
        <h2>Scene ${escapeHtml(scene.position)}</h2>
        <p><strong>${escapeHtml(scene.title || 'Untitled scene')}</strong></p>
        <p>${escapeHtml(scene.purpose || '')}</p>
        <p>${escapeHtml(scene.prompt || '')}</p>
      </li>`).join('')}
    </ol>
  </body>
</html>`;
    return {
      extension: 'html',
      contentType: 'text/html; charset=utf-8',
      content: html,
      summary: { scenes: scenePayload.length, deliverableScenes: scenePayload.filter((scene) => scene.output_url).length },
    };
  }

  const deliverableScenes = scenePayload.filter((scene) => scene.output_url);
  if (!deliverableScenes.length) return null;

  return {
    extension: 'json',
    contentType: 'application/json; charset=utf-8',
    content: JSON.stringify(
      {
        export_type: exportType,
        project: {
          id: project.id,
          title: project.title,
          logline: project.logline || null,
        },
        scenes: deliverableScenes,
      },
      null,
      2
    ),
    summary: { scenes: scenePayload.length, deliverableScenes: deliverableScenes.length },
  };
}
