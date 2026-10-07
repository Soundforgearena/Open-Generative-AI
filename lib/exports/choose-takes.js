/** Each scene's approved take, or its newest finished take. */
export function chooseTakes(scenes, versions) {
  const missing = [];
  const takes = [];
  for (const scene of scenes) {
    const mine = versions
      .filter((v) => v.scene_id === scene.id && v.output_url)
      .sort((a, b) => Number(b.version) - Number(a.version));
    const pick = mine.find((v) => v.approved) || mine[0];
    if (pick) takes.push({ scene_id: scene.id, version_id: pick.id, url: pick.output_url, duration: Number(scene.duration_seconds) || 0 });
    else missing.push(`Scene ${scene.position}${scene.title ? ` (${scene.title})` : ''}`);
  }
  return { takes, missing };
}
