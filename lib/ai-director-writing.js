const SAFE_STYLE_NOTE = 'I can help with high-level traits such as sparse dialogue, dreamy imagery, or tense pacing without copying a living creator’s exact style.';

function baseResult(title, suggestion, whatChanged, craftNote, followUpPrompts = []) {
  return { title, suggestion, whatChanged, craftNote, followUpPrompts };
}

function subject(context) {
  return context.value?.trim() || 'your central idea';
}

function generateIdeaDirections(context) {
  const seed = subject(context);
  return baseResult('Three story directions', `1. A character discovers a hidden cost inside ${seed}.\n2. A simple promise becomes impossible to keep when the world changes.\n3. Someone must choose between belonging and telling the truth.`, 'Turned the seed into three distinct narrative engines.', 'A strong premise combines a person, a desire, and a pressure that makes the choice difficult.', ['Which character wants this most?', 'What could be lost?']);
}

function expandStory(context) {
  return baseResult('Expanded story beat', `${subject(context)} becomes a focused ${context.duration || 30}-second story: introduce the want, reveal the obstacle, force a choice, then end on an image that shows what changed.`, 'Added a compact dramatic arc without replacing the original idea.', 'For a short film, one clear emotional shift is more powerful than several unrelated events.', ['What does the protagonist believe at the start?', 'What image should close the film?']);
}

function buildStoryArc(context) {
  return baseResult('Beginning, middle, and end', `Beginning: establish the person and the promise.\nMiddle: make the promise harder to keep through a specific obstacle.\nEnd: let the character choose, then show the consequence through action.`, 'Organized the idea into a three-part structure.', 'Structure is a promise to the audience about what kind of change they will witness.', ['What is the turning point?', 'Can the ending be shown without explanation?']);
}

function improvePacing(context) {
  return baseResult('Pacing pass', `${subject(context)} should move in clean beats: establish quickly, escalate with shorter moments, pause before the decision, and finish on a decisive visual.`, 'Suggested rhythm and emphasis points.', 'Pacing comes from changing pressure, not only from cutting faster.', ['Where can silence create tension?', 'Which beat is essential?']);
}

function raiseStakes(context) {
  return baseResult('Higher-stakes direction', `Give ${subject(context)} a cost that is personal, immediate, and visible. Let the obstacle remove an easy option before the final choice.`, 'Made the consequence more specific and cinematic.', 'The best stakes are felt through a character’s behavior before they are explained in dialogue.', ['What can the character no longer undo?', 'Who else is affected?']);
}

function createCharacter(context) {
  return baseResult('Character sketch', `Give the lead a visible want, a private fear, and one contradiction: they pursue ${subject(context)} while avoiding the truth it reveals.`, 'Added motivation, fear, and contradiction.', 'A contradiction creates playable behavior and gives actors something to perform.', ['What does the character refuse to admit?', 'What object reveals their history?']);
}

function suggestEnding(context) {
  return baseResult('Three ending options', '1. The choice succeeds, but the final image reveals its cost.\n2. The character refuses the expected choice and changes the meaning of the opening image.\n3. The answer arrives too late, leaving one precise image unresolved.', 'Offered three ending shapes rather than declaring one final answer.', 'A memorable ending changes how we understand something we saw earlier.', ['Which ending matches the tone?', 'What should the audience feel after cut to black?']);
}

function improveDialogue(context) {
  return baseResult('Dialogue pass', `${subject(context)} can become more natural when each speaker wants something different, avoids the direct question, and leaves one thought unfinished.`, 'Added subtext and opposing wants without inventing a final script.', 'Subtext is what the character is trying not to say.', ['What is each speaker hiding?', 'Can an action replace one line?']);
}

function writeNextScene(context) {
  return baseResult('Next scene draft', `INT. CONTINUATION — LATER\nThe pressure from ${subject(context)} has changed the room. A character makes one small decision that creates a larger problem. Hold on the consequence before the next cut.`, 'Proposed a screenplay-beat continuation.', 'A next scene should change the situation, not only repeat the mood.', ['What new information arrives?', 'Who enters with a different objective?']);
}

function tightenScene(context) {
  return baseResult('Tightened scene', `${subject(context)}: enter late, give the scene one purpose, make the turn visible, and leave as soon as the new question is clear.`, 'Reduced the scene to its essential dramatic movement.', 'Every scene should either change a relationship, reveal information, or force a decision.', ['What can start later?', 'What is the turn?']);
}

function createVisualDirection(context) {
  return baseResult('Visual direction', `Use ${context.style || 'cinematic'} language with a deliberate contrast: controlled framing at first, then a subtle camera shift as the character’s certainty breaks. Let light, color, and production design carry the subtext.`, 'Added a visual strategy for tone and emotional change.', 'A visual motif becomes powerful when it changes meaning during the story.', ['What color belongs to the character’s want?', 'What camera movement marks the turn?']);
}

function improveScenePurpose(context) {
  return baseResult('Scene purpose', `This scene should introduce pressure, give the character a difficult choice, and end with a changed situation that the next scene must answer.`, 'Clarified the scene’s dramatic job.', 'If a scene has two purposes, choose the one that creates the strongest change.', ['What changes by the final frame?', 'What question carries forward?']);
}

function applyDirectorInstruction(context, instruction) {
  const request = instruction?.trim() || 'Make this more cinematic.';
  if (/style of|in the style of|like [a-z]/i.test(request)) {
    return baseResult('High-level style alternative', `${SAFE_STYLE_NOTE}\n\nInstead, use broad traits requested by the note: focused pacing, distinctive imagery, purposeful silence, and emotionally specific behavior.`, 'Translated the request into general craft traits.', 'Specific craft choices are more useful than imitation.', ['Which trait should lead: pacing, imagery, dialogue, or mood?']);
  }
  return baseResult('Director response', `${request}\n\nA useful next pass is to make one concrete choice visible in the writing: who wants what, what blocks them, and what changes by the end.`, 'Responded to your instruction with an actionable craft pass.', 'You remain the final creative decision-maker; keep only what serves your project.', ['What should the audience feel?', 'Which moment needs the most attention?']);
}

function generateDirectorSuggestion(action, context = {}) {
  const actions = { generateIdeaDirections, expandStory, buildStoryArc, improvePacing, raiseStakes, createCharacter, suggestEnding, improveDialogue, writeNextScene, tightenScene, createVisualDirection, improveScenePurpose };
  return (actions[action] || applyDirectorInstruction)(context);
}

module.exports = {
  generateIdeaDirections,
  expandStory,
  buildStoryArc,
  improvePacing,
  raiseStakes,
  createCharacter,
  suggestEnding,
  improveDialogue,
  writeNextScene,
  tightenScene,
  createVisualDirection,
  improveScenePurpose,
  applyDirectorInstruction,
  generateDirectorSuggestion,
};
