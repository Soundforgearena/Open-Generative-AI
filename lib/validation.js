export function validateProjectInput(values) {
  const errors = {};
  if (!values.title?.trim()) errors.title = 'Add a project title.';
  if (!values.sourceText?.trim()) errors.sourceText = 'Add an idea, story, or script.';
  if (!values.style) errors.style = 'Choose a visual style.';
  if (!values.aspectRatio) errors.aspectRatio = 'Choose an aspect ratio.';
  if (!values.duration) errors.duration = 'Choose a target duration.';
  return errors;
}
