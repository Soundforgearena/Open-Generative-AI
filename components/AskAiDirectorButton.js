'use client';

import { useRef, useState } from 'react';
import AiDirectorAssistant from './AiDirectorAssistant';

export default function AskAiDirectorButton({ fieldType, value, context = {}, onApply }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const disabled = !value?.trim();

  return (
    <>
      <button
        type="button"
        ref={buttonRef}
        className="cinex-ask-director-button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-expanded={open}
        title={disabled ? 'Add some context before asking the Director' : 'Open AI Director'}
      >
        ✦ Ask AI Director
      </button>
      {disabled && <span className="cinex-ask-director-hint">Add text to enable Director guidance.</span>}
      {open && (
        <AiDirectorAssistant
          fieldType={fieldType}
          value={value}
          context={context}
          onApply={onApply}
          onClose={() => { setOpen(false); window.setTimeout(() => buttonRef.current?.focus(), 0); }}
        />
      )}
    </>
  );
}
