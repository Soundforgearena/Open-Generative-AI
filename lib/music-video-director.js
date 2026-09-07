function shotId(index) { return `music-shot-${index + 1}`; }

export function createSongSections(project) {
  const sections = project.songSections?.length ? project.songSections : ['Intro', 'Verse', 'Chorus', 'Outro'];
  const duration = Number(project.audioDurationSeconds || 30);
  const slice = duration / sections.length;
  return sections.map((section, index) => ({ section, startSeconds: Math.round(index * slice), endSeconds: Math.round((index + 1) * slice), energy: project.energyProfile?.[index] || 0.5 }));
}

export function createMusicVideoConcepts(project) {
  const style = project.visualDirection?.style || project.videoStyle || 'cinematic';
  return [
    { title: 'The emotional performance', logline: `A ${style.toLowerCase()} performance world that makes the final chorus feel earned.`, direction: 'Build intimacy in verses, then open the frame with the chorus.' },
    { title: 'The visual journey', logline: 'A character crosses a changing landscape while the song transforms the meaning of the journey.', direction: 'Repeat one visual motif and let it evolve with the sections.' },
    { title: 'The impossible room', logline: 'A stylized space responds to the rhythm, turning inner feeling into production design.', direction: 'Use restrained movement first, then let color and camera break free.' },
  ];
}

export function createMusicVideoTreatment(project) {
  const concepts = createMusicVideoConcepts(project);
  return {
    logline: concepts[0].logline,
    emotionalDestination: project.visualDirection?.feeling || 'euphoric',
    coreConcept: concepts[0].direction,
    performanceConcept: `${project.vocalStrategy || 'Artist performance'} with camera movement that follows the song's energy.`,
    narrativeConcept: 'A simple visual journey gives the lyrics an emotional place to land.',
    visualWorld: project.visualDirection?.notes || 'Cinematic light, practical texture, and a recurring gold motif.',
    colorLighting: 'Deep navy shadows, warm gold highlights, and controlled contrast.',
    cameraLanguage: 'Close, human verses; wider, moving chorus frames.',
    editingRhythm: 'Cut with the beat while protecting lyric moments and emotional pauses.',
    chorusHook: 'Return to one unmistakable image at every chorus.',
    repeatingMotif: 'A small light moving through darkness.',
    continuity: 'Keep wardrobe silhouette and motif consistent across performance setups.',
    locations: project.visualDirection?.locations || 'One primary location with two transformed lighting states.',
    wardrobe: project.visualDirection?.wardrobe || 'A recognizable silhouette that evolves subtly.',
    rightsNotes: 'Use only music and likenesses you own or are authorized to use.',
    structure: createSongSections(project),
    concepts,
  };
}

export function createLyricAwareShotPlan(project) {
  const sections = createSongSections(project);
  const lyricsConfirmed = project.lyricsMode === 'confirmed' || project.lyricsMode === 'official';
  return sections.map((section, index) => {
    const type = index % 3 === 0 ? 'performance' : index % 3 === 1 ? 'narrative' : 'transition';
    const lyric = project.lyricLines?.[index % Math.max(project.lyricLines.length, 1)];
    return {
      id: shotId(index), order: index + 1, section: section.section,
      startSeconds: section.startSeconds, endSeconds: section.endSeconds,
      durationSeconds: section.endSeconds - section.startSeconds, type,
      title: `${section.section} — ${type}`, purpose: `Carry the ${section.section.toLowerCase()} energy toward the emotional destination.`,
      lyricText: lyric?.text || '', lyricStartSeconds: lyric?.start || null, lyricEndSeconds: lyric?.end || null,
      lipSyncMode: project.lyricsMode === 'instrumental' ? 'none' : lyricsConfirmed ? 'eligible' : 'blocked',
      visualPrompt: `${project.visualDirection?.style || 'Cinematic'} ${type} shot for ${section.section}.`,
      cameraDirection: type === 'performance' ? 'Close push-in and human eye line.' : 'Controlled lateral movement.',
      movement: section.energy > 0.7 ? 'Build movement with the chorus energy.' : 'Let the frame breathe.',
      lighting: 'Gold practicals against deep blue shadows.', wardrobe: project.visualDirection?.wardrobe || 'Continuity wardrobe.',
      location: project.visualDirection?.locations || 'Primary music-video location.', continuityNotes: 'Match motif and artist silhouette.', status: 'draft',
    };
  });
}

export function createInstrumentalShotPlan(project) { return createLyricAwareShotPlan({ ...project, lyricsMode: 'instrumental' }); }
export function createTeaserPlan(project) { return createLyricAwareShotPlan({ ...project, audioDurationSeconds: Math.min(30, project.audioDurationSeconds || 30) }); }
export function createSocialCutPlan(project) { return createTeaserPlan({ ...project, aspectRatio: '9:16', targetOutput: 'social cuts' }); }
export function applyMusicDirectorInstruction(project, instruction) { return { title: 'Director draft', suggestion: `${instruction}\n\nTry a clear visual motif, a specific performance choice, and one chorus image that can return with greater emotional weight.`, whatChanged: 'Turned the instruction into an actionable music-video direction.', craftNote: 'A strong music video gives the song a visual memory without illustrating every lyric literally.', followUpPrompts: ['Which chorus image should the audience remember?'] }; }
