/**
 * Each scene's take for the finished cut.
 * - Lip-synced scenes use their approved lip-sync take, else the newest one.
 *   (A scene that needs lip sync but has none falls back to its video take
 *   and is listed in `unsynced` so the Studio can warn before export.)
 * - Other scenes use the approved take, or the newest finished take.
 * Song-timed scenes carry start_ms/end_ms so the renderer cuts them exactly.
 */
export function chooseTakes(scenes, versions) {
  const missing = [];
  const unsynced = [];
  const takes = [];
  for (const scene of scenes) {
    const mine = versions
      .filter((v) => v.scene_id === scene.id && v.output_url)
      .sort((a, b) => Number(b.version) - Number(a.version));
    const synced = mine.filter((v) => v.kind === 'lip_sync');
    let pick = null;
    if (scene.lip_sync && synced.length) pick = synced.find((v) => v.approved) || synced[0];
    if (!pick) pick = mine.find((v) => v.approved) || mine[0];
    const label = `Scene ${scene.position}${scene.title ? ` (${scene.title})` : ''}`;
    if (!pick) { missing.push(label); continue; }
    if (scene.lip_sync && pick.kind !== 'lip_sync') unsynced.push(label);
    const timed = Number.isFinite(Number(scene.start_ms)) && scene.start_ms !== null && Number(scene.end_ms) > Number(scene.start_ms);
    takes.push({
      scene_id: scene.id,
      version_id: pick.id,
      url: pick.output_url,
      duration: timed ? (Number(scene.end_ms) - Number(scene.start_ms)) / 1000 : Number(scene.duration_seconds) || 0,
      ...(timed ? { start_ms: Number(scene.start_ms), end_ms: Number(scene.end_ms) } : {}),
    });
  }
  return { takes, missing, unsynced };
}
