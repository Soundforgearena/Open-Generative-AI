/**
 * Director writing actions.
 *
 * Shared by the client panel and the server route so a request can only ask for
 * an action the product actually offers, and so the brief the model receives is
 * defined in one place.
 */
export const DIRECTOR_ACTION_BRIEFS = {
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
};

export const DIRECTOR_ACTIONS = Object.keys(DIRECTOR_ACTION_BRIEFS);

export const DIRECTOR_FIELD_BRIEFS = {
  idea: 'This is an early story idea.',
  story: 'This is a story outline.',
  script: 'This is script or scene writing.',
  visualNotes: 'This is visual direction for the camera and lighting team.',
  scene: 'This is a single scene in a larger piece.',
  title: 'This is a title or hook.',
};

export function isDirectorAction(action) {
  return Object.hasOwn(DIRECTOR_ACTION_BRIEFS, action);
}
