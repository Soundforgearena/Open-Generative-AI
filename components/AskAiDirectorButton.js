'use client';

import { useRef, useState } from 'react';
import AiDirectorAssistant from './AiDirectorAssistant';

/**
 * Opens the AI Director for a single field.
 *
 * This button used to be disabled whenever the field was empty, with a hint
 * telling the writer to add text first. That inverted the point of having a
 * director: the blank box is exactly where help is worth most. The Director is
 * now always available, and offers to write the first draft when there is
 * nothing to work from. Typing it yourself remains completely optional — the
 * field is never blocked and nothing is filled in without an explicit apply.
 */
export default function AskAiDirectorButton({ fieldType, value, context = {}, onApply, label }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const isEmpty = !value?.trim();

  return (
    <>
      <button
        type="button"
        ref={buttonRef}
        className="cinex-ask-director-button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        title={isEmpty ? 'Let the AI Director write the first draft' : 'Ask the AI Director to develop this'}
      >
        {isEmpty ? '✦ Draft this with AI Director' : '✦ Ask AI Director'}
      </button>
      {open && (
        <AiDirectorAssistant
          fieldType={fieldType}
          fieldLabel={label}
          value={value}
          context={context}
          onApply={onApply}
          onClose={() => { setOpen(false); window.setTimeout(() => buttonRef.current?.focus(), 0); }}
        />
      )}
    </>
  );
}
