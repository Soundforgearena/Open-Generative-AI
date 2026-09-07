const STOP_WORDS = new Set(['the', 'and', 'with', 'from', 'this', 'that', 'into']);

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `demo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function sceneCountForDuration(duration) {
  const seconds = Number(duration);
  if (seconds <= 15) return 3;
  if (seconds <= 30) return 5;
  if (seconds <= 60) return 6;
  return 8;
}

export function createStoryboard(sourceText, duration = 30, style = 'Cinematic') {
  const count = sceneCountForDuration(duration);
  const seconds = Math.max(3, Math.floor(Number(duration) / count));
  const words = sourceText.trim().split(/\s+/).filter((word) => !STOP_WORDS.has(word.toLowerCase()));
  const subject = words.slice(0, 5).join(' ') || 'the central idea';

  return Array.from({ length: count }, (_, index) => ({
    id: makeId(),
    sceneNumber: index + 1,
    title: index === 0 ? 'Establish the world' : index === count - 1 ? 'Resolve and cut to black' : `Beat ${index + 1}: ${subject}`,
    summary: index === 0 ? `Introduce ${subject} in a ${style.toLowerCase()} frame.` : `Advance the story through a focused ${style.toLowerCase()} visual beat.`,
    estimatedDuration: index === count - 1 ? Number(duration) - seconds * (count - 1) : seconds,
    estimatedDurationSeconds: index === count - 1 ? Number(duration) - seconds * (count - 1) : seconds,
    visualPrompt: `${style} shot inspired by: ${sourceText.trim()}`,
    narration: index === 0 ? 'Set the scene and establish the emotional promise.' : 'Let the image, movement, and sound carry the moment.',
    order: index + 1,
    status: 'draft',
  }));
}
