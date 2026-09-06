export function createContinuityBible(overrides = {}) {
  return {
    version: 1,
    projectVisualStyle: {
      realismLevel: 'cinematic', colorPalette: 'deep navy and warm gold', colorGrade: 'controlled contrast', lightingLanguage: 'motivated practical light', cameraLanguage: 'intentional movement', lensFeel: 'natural perspective', editingRhythm: 'cut with purpose', aspectRatio: '16:9', negativeConstraints: [],
    },
    characters: [], wardrobeLooks: [], locations: [], props: [], visualMotifs: [], globalRules: [],
    musicVideo: { performerProfiles: [], performanceLooks: [], songSectionRules: [], lyricSyncRules: [], recurringMotifs: [] },
    ...overrides,
  };
}

export function serializeContinuityBible(bible) {
  return JSON.parse(JSON.stringify({ ...createContinuityBible(), ...bible, version: 1 }));
}

export function createSceneContinuity(overrides = {}) {
  const state = { characterStates: [], wardrobeStates: [], propStates: [], locationState: {}, weather: '', timeOfDay: '', lighting: '', emotionalState: '', screenDirection: '', eyelineDirection: '', cameraAxis: '', musicSection: '', lyricRange: null, performanceState: '' };
  return { entryState: { ...state }, exitState: { ...state }, requiredReferences: [], continuityLocks: [], allowedChanges: [], handoffNotes: [], ...overrides };
}
