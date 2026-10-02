// Local-only sample data. Used exclusively when demo mode is enabled, which
// lib/demo-mode.js forbids in production builds.
import { serializeShotDirection } from './studio-model';

const base = { shot: 'Wide Shot', movement: 'Slow Push In', angle: 'Slight Low Angle', lens: '35mm (cinematic)', fps: '24 fps', resolution: '720p' };

const rows = [
  ['The Journey Begins', 12, 'Knight rides toward the mountain castle at dawn.', 'approved', true, '/HERO.jpeg'],
  ['The Dragon Appears', 18, 'Dragon emerges from clouds over the valley.', 'needs_review', false, '/hero.jpg.jpeg'],
  ['The Siege', 22, 'Dragon attacks the castle with fire and fury.', 'needs_review', false, '/HERO.jpeg'],
  ['The Choice', 14, 'The knight faces the dragon in the courtyard.', 'approved', true, '/hero.jpg.jpeg'],
  ['The Sacrifice', 20, 'The knight makes a final stand.', 'failed', false, '/HERO.jpeg'],
  ['A New Dawn', 16, 'The castle stands, but at a cost.', 'draft', false, ''],
];

export function demoStudioData() {
  const scenes = rows.map(([title, duration, purpose, status, locked, img], i) => ({
    id: `demo-scene-${i + 1}`,
    position: i + 1,
    title,
    purpose,
    duration_seconds: duration,
    status,
    continuity_locked: locked,
    prompt: i === 1
      ? 'A massive dragon emerges from storm clouds over a medieval mountain castle, its wings spread wide, fire in its mouth, dramatic cinematic lighting, epic scale, film still, high detail, volumetric clouds, dark fantasy atmosphere.'
      : `${purpose} Cinematic epic fantasy, dramatic lighting.`,
    shot_direction: serializeShotDirection({ ...base, tags: ['cinematic', 'epic fantasy', 'dramatic lighting', '8k', 'film still', 'volumetric clouds'] }),
    versions: img ? [{ id: `v${i}`, version: 1, status: 'completed', approved: status === 'approved', output_url: img, thumbnail_url: img }] : [],
  }));
  return {
    result: {
      project: { id: 'demo-project', title: "The Last Dragon's Keep", lane: 'episode', visual_identity: { style: 'Epic Fantasy', aspect_ratio: '16:9', style_tags: ['cinematic', 'epic', 'dramatic', 'film'] } },
      scenes,
      assets: [],
    },
    projects: [{ id: 'demo-project', title: "The Last Dragon's Keep" }],
    options: [{ model: 'demo-model', operation: 'video', label: 'CINEX-1 Pro', max_duration_seconds: 30, max_resolution: '1080p' }],
    credits: 2480,
  };
}
