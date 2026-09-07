'use client';

import { useState } from 'react';
import Link from 'next/link';
import CinexRoutePage from '@/components/CinexRoutePage';
import AskAiDirectorButton from '@/components/AskAiDirectorButton';
import { demoModeEnabled } from '@/lib/demo-mode';
import ContinuityGuardianPanel from '@/components/continuity/ContinuityGuardianPanel';
import ContinuityBibleEditor from '@/components/continuity/ContinuityBibleEditor';
import { createContinuityBible } from '@/lib/continuity/continuity-bible';

const sections = [
  ['story', 'Story', 'Shape the emotional journey and central promise.'],
  ['characters', 'Characters', 'Start with a person who wants something.'],
  ['structure', 'Structure', 'Decide what changes by the end.'],
  ['dialogue', 'Dialogue', 'Use dialogue to reveal want, conflict, and subtext.'],
  ['visual', 'Visual Direction', 'Use visual action, not only dialogue.'],
  ['scenes', 'Scene Plan', 'Keep each short-film scene focused on one emotional shift.'],
  ['continuity', 'Continuity', 'Track the details that make the world feel intentional.'],
];

export default function DirectorPage() {
  const [values, setValues] = useState({ story: '', characters: '', structure: '', dialogue: '', visual: '', scenes: '', continuity: '' });
  const [open, setOpen] = useState('story');
  const update = (name, value) => setValues((current) => ({ ...current, [name]: value }));

  return (
    <CinexRoutePage
      eyebrow="Writing room"
      title="AI Director"
      description="A creative AI persona for story development, screenwriting, and cinematic decisions. You are always the final creative decision-maker."
    >
      {demoModeEnabled && <p className="cinex-demo-indicator">Demo Director preview — suggestions are generated locally. No model call, video generation, or credits are used.</p>}
      <ContinuityGuardianPanel project={{ id: 'director-room', continuityBible: createContinuityBible(), scenes: [] }} onFix={() => setOpen('story')} />
      <ContinuityBibleEditor value={createContinuityBible()} onChange={() => {}} />
      <details className="cinex-beginner-guidance">
        <summary>Beginner guidance</summary>
        <ul>
          <li>Start with a person who wants something.</li>
          <li>Give the character an obstacle.</li>
          <li>Decide what changes by the end.</li>
          <li>Keep each short-film scene focused on one emotional shift.</li>
          <li>Use visual action, not only dialogue.</li>
          <li>You are always the final creative decision-maker.</li>
        </ul>
      </details>
      <div className="cinex-director-room" role="tablist" aria-label="AI Director writing room">
        <div className="cinex-director-tabs">
          {sections.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={open === id} className={open === id ? 'is-selected' : ''} onClick={() => setOpen(id)}>{label}</button>)}
        </div>
        <section className="cinex-director-section" role="tabpanel">
          <h2>{sections.find(([id]) => id === open)?.[1]}</h2>
          <p>{sections.find(([id]) => id === open)?.[2]}</p>
          <label>
            {open === 'story' ? 'Story direction' : 'Director notes'}
            <textarea value={values[open]} onChange={(event) => update(open, event.target.value)} rows={8} placeholder="Tell the Director what you want to explore..." />
          </label>
          <AskAiDirectorButton fieldType={open === 'dialogue' ? 'script' : open === 'visual' ? 'visualNotes' : open === 'story' ? 'story' : 'scene'} value={values[open]} context={{ sourceType: 'director-room', style: 'Cinematic' }} onApply={(suggestion) => update(open, suggestion)} />
        </section>
      </div>
      <Link href="/create/review" className="cinex-route-secondary-link">Back to project review</Link>
    </CinexRoutePage>
  );
}
