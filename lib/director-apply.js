/**
 * Pure helpers for applying an AI Director suggestion back into a form field.
 *
 * The apply step used to be written inline in the component, which meant the
 * one behaviour a writer actually depends on — "Replace field" really replacing
 * the story text — had no test coverage at all. Keeping it here makes it
 * testable and keeps the component free of string juggling.
 */

const APPLY_MODES = ['replace', 'insert'];

function normalizeSuggestion(suggestion) {
  return typeof suggestion === 'string' ? suggestion.trim() : '';
}

/**
 * Work out the new field value for an apply action.
 *
 * @param {'replace'|'insert'} mode
 * @param {string} currentValue the text currently in the field
 * @param {string} suggestion the Director's draft
 * @returns {string|null} the new value, or null when there is nothing to apply
 */
function buildAppliedValue(mode, currentValue, suggestion) {
  const draft = normalizeSuggestion(suggestion);
  if (!draft || !APPLY_MODES.includes(mode)) return null;

  if (mode === 'replace') return draft;

  const existing = typeof currentValue === 'string' ? currentValue.trimEnd() : '';
  // Inserting into an empty field should not leave the draft pushed down by
  // blank lines.
  return existing ? `${existing}\n\n${draft}` : draft;
}

module.exports = { APPLY_MODES, buildAppliedValue };
