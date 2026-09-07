export const MUSIC_PROJECTS_KEY = 'cinexvideo_demo_music_video_projects_v1';

export const DEMO_TRACKS = [
  { id: 'dark-electronic-30', title: 'Dark Electronic Signal', duration: 30, bpm: 118, energy: [0.25, 0.42, 0.7, 0.92], vocal: true, sections: ['Intro', 'Verse', 'Chorus', 'Outro'] },
  { id: 'cinematic-pop-60', title: 'Cinematic Pop Horizon', duration: 60, bpm: 104, energy: [0.2, 0.45, 0.8, 0.65, 0.95], vocal: true, sections: ['Intro', 'Verse 1', 'Pre-Chorus', 'Chorus', 'Bridge', 'Final Chorus'] },
  { id: 'hip-hop-90', title: 'Hip-Hop Performance Cut', duration: 90, bpm: 92, energy: [0.55, 0.7, 0.88, 0.62, 0.9], vocal: true, sections: ['Intro', 'Verse 1', 'Chorus', 'Verse 2', 'Bridge', 'Final Chorus'] },
  { id: 'ambient-45', title: 'Ambient Instrumental Drift', duration: 45, bpm: 72, energy: [0.18, 0.3, 0.38, 0.28], vocal: false, sections: ['Opening', 'Expansion', 'Suspension', 'Release'] },
];

function storage() { return typeof window !== 'undefined' ? window.localStorage : null; }
function id() { return globalThis.crypto?.randomUUID?.() || `music-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function read() { try { const parsed = JSON.parse(storage()?.getItem(MUSIC_PROJECTS_KEY) || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function write(projects) { try { storage()?.setItem(MUSIC_PROJECTS_KEY, JSON.stringify(projects)); return true; } catch { return false; } }

export function listMusicProjects() { return read().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)); }
export function getMusicProject(projectId) { return read().find((project) => project.id === projectId) || null; }
export function saveMusicProject(project) { const next = { ...project, updatedAt: new Date().toISOString() }; const projects = read(); const index = projects.findIndex((item) => item.id === next.id); if (index >= 0) projects[index] = next; else projects.unshift(next); write(projects); return next; }
export function resetMusicProjects() { storage()?.removeItem(MUSIC_PROJECTS_KEY); }

export function createMusicProject(input) {
  const now = new Date().toISOString();
  return saveMusicProject({
    id: id(), projectType: 'music-video', title: input.title || input.track?.title || 'Untitled music video',
    musicSourceType: input.musicSourceType || 'demo-profile', rightsConfirmed: Boolean(input.rightsConfirmed),
    demoTrackProfileId: input.track?.id || null, originalFileName: null,
    audioDurationSeconds: input.track?.duration || 0, bpmEstimate: input.track?.bpm || 0,
    energyProfile: input.track?.energy || [], songSections: input.track?.sections || [],
    lyricsMode: input.lyricsMode || (input.track?.vocal ? 'official' : 'instrumental'),
    lyrics: input.lyrics || '', lyricLines: input.lyricLines || [], vocalStrategy: input.vocalStrategy || 'Artist performance close-ups',
    videoStyle: input.videoStyle || 'Performance + narrative', visualDirection: input.visualDirection || {},
    aspectRatio: input.aspectRatio || '16:9', targetOutput: input.targetOutput || 'full music video',
    directorTreatment: null, storyboard: [], status: 'draft', createdAt: now, updatedAt: now,
  });
}
