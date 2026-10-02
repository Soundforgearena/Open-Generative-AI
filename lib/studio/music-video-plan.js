// Builds a real, editable starting plan for a music video project.

const SECTIONS = [
  ['Intro', 8, 'Establish the world before the first note lands.'],
  ['Verse 1', 12, 'Introduce the artist and the story they are telling.'],
  ['Pre-Chorus', 8, 'Tension builds; the camera starts to move with the beat.'],
  ['Chorus', 12, 'The hook. The boldest image in the video.'],
  ['Verse 2', 12, 'The story deepens; a new location or a shift in light.'],
  ['Bridge', 10, 'The turn. Strip it back or break the pattern.'],
  ['Final Chorus', 14, 'Payoff. Everything the video promised, delivered.'],
  ['Outro', 8, 'Leave them with one unforgettable final frame.'],
];

const STYLE_LOOK = {
  Performance: 'artist performing to camera, stage lighting, haze, rim light',
  'Narrative short film': 'cinematic narrative moment, naturalistic light, shallow depth of field',
  'Performance + narrative': 'artist performance intercut with a cinematic story moment',
  'Abstract / art film': 'abstract art-film imagery, bold color fields, surreal composition',
  'Lyric video': 'kinetic typography space, graphic composition, clean negative space',
  'Animated concept': 'stylized animated world, painterly lighting, bold shapes',
};

export function buildMusicVideoPlan({ title, style = 'Performance + narrative', feeling = 'euphoric', aspectRatio = '16:9', lyrics = '' }) {
  const look = STYLE_LOOK[style] || STYLE_LOOK['Performance + narrative'];
  const lines = String(lyrics || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const ratio = aspectRatio === '2.39:1' ? '21:9' : aspectRatio;
  return {
    creative_title: String(title || 'Untitled music video').slice(0, 200),
    logline: `A ${feeling} ${style.toLowerCase()} music video.`,
    visual_identity: { style, aspect_ratio: ratio, style_notes: `${feeling} energy, ${look}.`, style_tags: ['music video', feeling, 'cinematic'] },
    scenes: SECTIONS.map(([name, seconds, purpose], i) => {
      const lyric = lines.length ? lines[Math.floor((i / SECTIONS.length) * lines.length)] : '';
      return {
        title: name,
        purpose: lyric ? `${purpose} Lyric: “${lyric.slice(0, 160)}”` : purpose,
        duration_seconds: seconds,
        prompt: `${name} of a ${feeling} music video: ${look}${lyric ? `, visualising the line “${lyric.slice(0, 120)}”` : ''}, cinematic, music video aesthetic.`,
      };
    }),
  };
}
