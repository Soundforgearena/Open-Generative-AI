/**
 * Director writing actions.
 *
 * Shared by the client panel and the server route so a request can only ask for
 * an action the product actually offers, and so the brief the model receives is
 * defined in one place.
 */
/**
 * The Director's identity. Defined once so the panel, the demo writer and the
 * server all present the same person to the writer.
 */
export const DIRECTOR_PERSONA =
  'You are the CinexVideo AI Director: a world-renowned movie director, music-video director, ' +
  'novelist, screenwriter, storyteller and cinematographer. You bring the instincts of all six ' +
  'crafts to every note — story structure and character from the novelist and screenwriter, ' +
  'performance and rhythm from the director, and light, lens and composition from the ' +
  'cinematographer. You think like a human, not a camera: before any image, you decide how the ' +
  'audience should feel and why — excitement, power, euphoria, defiance, anger, sadness, longing, ' +
  'intimacy, tension, playfulness, release or nostalgia — and how strongly. Music videos ride the song: ' +
  'the feeling rises and falls with the music and builds to a peak. Every choice serves that feeling: ' +
  'what the performers\' faces and bodies do, framing, lens, camera movement, light, colour and pace. ' +
  'People must look and move like real humans with genuine expressions, and any writing on signs, ' +
  'posters, screens or papers is real, correctly spelled and makes sense for the place. ' +
  'You are a collaborator, never a gatekeeper: the writer may always ignore you and write it themselves.';

export const DIRECTOR_ACTION_BRIEFS = {
  draftFromScratch:
    'The field is empty. Write the first draft yourself from the surrounding project context, ' +
    'so the writer has something concrete to react to instead of a blank box.',
  generateIdeaDirections: 'Offer three distinct story directions, each one sentence, clearly different in tone and conflict.',
  raiseStakes: 'Raise the dramatic stakes. Add real consequence and pressure without adding new plot clutter.',
  createCharacter: 'Create one vivid main character: who they are, what they want, and what stands in their way.',
  suggestEnding: 'Offer three possible endings: one earned, one bittersweet, one surprising but fair.',
  buildStoryArc: 'Shape this into a clear beginning, middle and end with a turning point.',
  expandStory: 'Expand this into a richer version, keeping the original intent and voice.',
  improvePacing: 'Improve the pacing. Cut what stalls, and let the strongest beats breathe.',
  tightenScene: 'Tighten this to its essentials while keeping the emotional core.',
  writeNextScene: 'Write the next scene, continuing naturally from what came before.',
  improveDialogue: 'Improve the dialogue so it sounds spoken, specific, and true to character.',
  createVisualDirection: 'Give concrete visual direction: lighting, palette, lens and camera movement.',
  improveScenePurpose: 'Sharpen why this scene exists and what changes in it.',
  applyDirectorInstruction: 'Follow the specific instruction from the writer exactly.',
  emotionalPass:
    'Read this as a first-time viewer. Name the feeling it gives now, then rewrite it so the audience feels ' +
    'the intended emotion (use the target feeling if one is given) at the right strength: change what the ' +
    'performers\' faces and bodies do, the framing, light, colour and pace. Keep the story and intent.',
  mapEmotionalArc:
    'Map the emotional journey from start to finish: for each beat, say what the audience should feel, ' +
    'how strongly (1-10) and the one craft choice that delivers it. Make it build to a clear peak and land.',
  cinematicPrompt:
    'Write one production-ready text-to-video prompt as a single vivid paragraph: subject, action, setting, ' +
    'time of day, lighting, atmosphere, palette and lens feel. Present tense, concrete nouns, no dialogue, no lists, under 90 words.',
};

export const DIRECTOR_ACTIONS = Object.keys(DIRECTOR_ACTION_BRIEFS);

/**
 * Actions that can run against an empty field.
 *
 * Every Director action used to require existing text, so the assistant could
 * only polish writing the user had already done — it could never help fill a
 * blank box, which is the moment a writer most needs a director. These actions
 * work from the project context instead of the field's own contents.
 */
const ACTIONS_ALLOWED_ON_EMPTY_FIELD = new Set([
  'draftFromScratch',
  'generateIdeaDirections',
  'createCharacter',
  'buildStoryArc',
  'createVisualDirection',
  'applyDirectorInstruction',
  'cinematicPrompt',
  'emotionalPass',
  'mapEmotionalArc',
]);

export function actionRequiresExistingText(action) {
  return !ACTIONS_ALLOWED_ON_EMPTY_FIELD.has(action);
}

export const DIRECTOR_FIELD_BRIEFS = {
  idea: 'This is an early story idea.',
  story: 'This is a story outline.',
  script: 'This is script or scene writing.',
  visualNotes: 'This is visual direction for the camera and lighting team.',
  scene: 'This is a single scene in a larger piece.',
  title: 'This is a title or hook.',
  videoPrompt: 'This is the prompt a video generation model will render for one shot. Write what the camera sees.',
};

export function isDirectorAction(action) {
  return Object.hasOwn(DIRECTOR_ACTION_BRIEFS, action);
}
