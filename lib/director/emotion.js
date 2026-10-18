// The Director's emotional brain. Pure functions only (no network, no AI
// cost), so it runs for every project and is fully unit tested.
//
// A human director starts with one question for every shot: how should the
// audience feel right now, and why? This module answers it from the song
// itself (section, lyric words, loudness) and turns the answer into craft:
// framing, lens, camera movement, light, colour, performance and crowd.

export const EMOTIONS = Object.freeze({
  euphoria: {
    label: 'Euphoria',
    viewer: 'pure, rising joy: they want to jump up and join in',
    performance: 'wide genuine smiles that reach the eyes, heads thrown back laughing, arms up, bodies bouncing loose and free',
    crowd: 'the whole crowd erupts, jumping and singing along, hands in the air',
    light: 'bright warm practical lights, flares and confetti catching the light',
    grade: 'saturated warm colour, glowing highlights',
    pace: 'fast, cut on every beat',
    sung: { shot: 'Medium Close-Up', movement: 'Handheld', angle: 'Slight Low Angle', lens: '35mm (cinematic)' },
    broll: { shot: 'Wide Shot', movement: 'Handheld', angle: 'Low Angle', lens: '24mm (wide)' },
    perform: 'with joy',
  },
  power: {
    label: 'Power',
    viewer: 'strength and confidence: they feel ten feet tall',
    performance: 'steady unblinking eye contact, chin slightly raised, chest open, slow deliberate confident movement, a knowing half-smile',
    crowd: 'the crowd moves as one behind the artist, in sync and unstoppable',
    light: 'hard key light from the side, strong rim light, deep shadows',
    grade: 'rich contrast, deep blacks, bold colour',
    pace: 'measured, hits land on the downbeat',
    sung: { shot: 'Medium Close-Up', movement: 'Slow Push In', angle: 'Slight Low Angle', lens: '50mm (natural)' },
    broll: { shot: 'Full Shot', movement: 'Dolly Track', angle: 'Low Angle', lens: '24mm (wide)' },
    perform: 'with confident power',
  },
  defiance: {
    label: 'Defiance',
    viewer: 'rebellious pride: nobody can tell them what to do',
    performance: 'a cheeky defiant grin, eyebrows raised, shoulders squared, head tilted as if daring the camera',
    crowd: 'people shrug off the rules, dancing anyway, playful and proud',
    light: 'colourful neon mixed with street light',
    grade: 'punchy colour with a slight edge',
    pace: 'bold, cuts on the accents',
    sung: { shot: 'Close-Up', movement: 'Handheld', angle: 'Slight Low Angle', lens: '35mm (cinematic)' },
    broll: { shot: 'Medium Shot', movement: 'Handheld', angle: 'Low Angle', lens: '35mm (cinematic)' },
    perform: 'with defiant pride',
  },
  anger: {
    label: 'Anger',
    viewer: 'raw heat and frustration: their jaw tightens with the artist',
    performance: 'furrowed brow, intense stare, tight jaw, sharp forceful gestures on the beat',
    crowd: 'the crowd pushes forward, chanting hard, fists pumping',
    light: 'harsh red and amber light, strobing on the hits',
    grade: 'hot reds, crushed shadows, gritty texture',
    pace: 'aggressive, fast hard cuts',
    sung: { shot: 'Close-Up', movement: 'Handheld', angle: 'Eye Level', lens: '35mm (cinematic)' },
    broll: { shot: 'Medium Shot', movement: 'Handheld', angle: 'Dutch Angle', lens: '24mm (wide)' },
    perform: 'with fierce intensity',
  },
  sadness: {
    label: 'Sadness',
    viewer: 'an ache in the chest: they feel the loss with the artist',
    performance: 'eyes glistening, gaze drifting down then back to camera, slow breaths, small trembling pauses, no forced smile',
    crowd: 'the party fades into the background, people blurred and slowed',
    light: 'a single soft cool key light, gentle falloff into darkness',
    grade: 'desaturated cool blues, soft contrast',
    pace: 'slow, let shots breathe',
    sung: { shot: 'Close-Up', movement: 'Slow Push In', angle: 'Eye Level', lens: '85mm (portrait)' },
    broll: { shot: 'Wide Shot', movement: 'Static', angle: 'High Angle', lens: '85mm (portrait)' },
    perform: 'with quiet sadness',
  },
  longing: {
    label: 'Longing',
    viewer: 'bittersweet yearning: they want something just out of reach',
    performance: 'soft searching eyes, a faint wistful smile, looking past the lens then back, gentle swaying',
    crowd: 'couples and friends in soft focus, one person watching from the edge',
    light: 'warm backlight halos, soft bokeh from string lights',
    grade: 'warm amber with soft faded highlights',
    pace: 'flowing, lingering',
    sung: { shot: 'Medium Close-Up', movement: 'Orbit', angle: 'Eye Level', lens: '85mm (portrait)' },
    broll: { shot: 'Medium Shot', movement: 'Slow Push In', angle: 'Eye Level', lens: '85mm (portrait)' },
    perform: 'with longing',
  },
  intimacy: {
    label: 'Intimacy',
    viewer: 'closeness and warmth: it feels like the artist is singing to them alone',
    performance: 'relaxed soft eyes, small private smiles, slow natural blinks, leaning gently toward the lens',
    crowd: 'two people close together, the world blurred around them',
    light: 'warm low candle-like light, soft shadows',
    grade: 'warm skin tones, creamy highlights',
    pace: 'slow and tender',
    sung: { shot: 'Close-Up', movement: 'Static', angle: 'Eye Level', lens: '85mm (portrait)' },
    broll: { shot: 'Close-Up', movement: 'Slow Push In', angle: 'Eye Level', lens: '85mm (portrait)' },
    perform: 'tenderly',
  },
  tension: {
    label: 'Tension',
    viewer: 'anticipation: they lean in, waiting for the drop',
    performance: 'still and focused, a slow intake of breath, eyes locked on the lens, a hint of a smile held back',
    crowd: 'the crowd frozen mid-move, everyone waiting for the beat to land',
    light: 'low key with pockets of light, slowly building',
    grade: 'cool shadows with one warm accent',
    pace: 'held, building',
    sung: { shot: 'Close-Up', movement: 'Slow Push In', angle: 'Eye Level', lens: '50mm (natural)' },
    broll: { shot: 'Wide Shot', movement: 'Slow Push In', angle: 'Eye Level', lens: '35mm (cinematic)' },
    perform: 'with building intensity',
  },
  playful: {
    label: 'Playful',
    viewer: 'laughter and fun: they grin and want to share it',
    performance: 'mischievous grins, raised eyebrows, side-eye glances to camera, trying not to laugh, then breaking',
    crowd: 'friends teasing each other, someone doing a silly move, everyone cracking up',
    light: 'bright colourful party light',
    grade: 'vivid, cheerful colour',
    pace: 'bouncy, comic timing on the beat',
    sung: { shot: 'Medium Close-Up', movement: 'Handheld', angle: 'Eye Level', lens: '35mm (cinematic)' },
    broll: { shot: 'Medium Shot', movement: 'Pan Right', angle: 'Eye Level', lens: '35mm (cinematic)' },
    perform: 'playfully, fighting a laugh',
  },
  release: {
    label: 'Release',
    viewer: 'catharsis: everything built up finally lets go',
    performance: 'eyes closed then opening wide, a huge exhale into a smile, arms opening outward',
    crowd: 'the biggest moment of the night: everyone together, confetti falling',
    light: 'light floods the scene, golden glow',
    grade: 'golden warm, lifted highlights',
    pace: 'big, sweeping',
    sung: { shot: 'Medium Shot', movement: 'Crane Up', angle: 'Slight Low Angle', lens: '35mm (cinematic)' },
    broll: { shot: 'Extreme Wide Shot', movement: 'Crane Up', angle: 'Low Angle', lens: '24mm (wide)' },
    perform: 'with total release',
  },
  nostalgia: {
    label: 'Nostalgia',
    viewer: 'a warm memory: the night they will never forget',
    performance: 'soft contented smiles, looking around at friends, a slow nod to the beat',
    crowd: 'the party winding down, friends with arms around each other',
    light: 'fading warm practical lights, gentle haze',
    grade: 'soft warm film tones with gentle grain',
    pace: 'slowing, reflective',
    sung: { shot: 'Medium Close-Up', movement: 'Pull Out', angle: 'Eye Level', lens: '50mm (natural)' },
    broll: { shot: 'Wide Shot', movement: 'Pull Out', angle: 'High Angle', lens: '35mm (cinematic)' },
    perform: 'warmly, with a smile',
  },
});

export const EMOTION_KEYS = Object.keys(EMOTIONS);

// Words that pull a line toward a feeling. Short, human, and obvious.
const LEXICON = {
  sadness: /\b(cry|cried|crying|tears?|alone|lonely|miss(ing)?|gone|pain|hurts?|lost|broken|goodbye|sorry|cold|empty|without you)\b/i,
  anger: /\b(hate|fight|mad|angry|burn|enough|liar?s?|lie|rage|war|fed up|blood)\b/i,
  power: /\b(king|queen|boss|rise|strong|power|run (it|this|the)|can'?t stop|unstoppable|champion|crown|fire|loud|we (own|run))\b/i,
  euphoria: /\b(party|dance|dancing|tonight|celebrate|wild|jump|hands up|alive|turn up|vibe|carnival|feel good|let'?s go)\b/i,
  intimacy: /\b(baby|kiss|hold (me|you)|close|touch|my love|darling|honey|tender)\b/i,
  longing: /\b(wish|dream|someday|waiting|remember|if only|far away|come back|need you)\b/i,
  defiance: /\b(don'?t care|can'?t tell me|my way|rules?|who (cares|says)|watch me|no way)\b/i,
  playful: /\b(lol|haha|funny|joke|uncle|auntie|silly|crazy|act normal|cheeky|wink)\b/i,
};

const SECTION_PRIORS = [
  { re: /final (hook|chorus)|last (hook|chorus)/i, emotion: 'release', boost: 2 },
  { re: /hook|chorus|drop/i, emotion: 'euphoria', boost: 1.5 },
  { re: /pre-?(hook|chorus)|build/i, emotion: 'tension', boost: 0.5 },
  { re: /bridge/i, emotion: 'longing', boost: 0 },
  { re: /intro/i, emotion: 'tension', boost: -1 },
  { re: /outro|ending/i, emotion: 'nostalgia', boost: -1 },
  { re: /verse/i, emotion: 'playful', boost: 0 },
];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * What the audience should feel in one scene, how strongly (1-10) and why.
 * energy: the scene's loudness relative to the song (0 = quietest, 1 = loudest).
 */
export function inferEmotion({ section = '', lyric = '', energy = 0.5, sung = false } = {}) {
  const text = String(lyric || '');
  const hits = Object.entries(LEXICON).filter(([, re]) => re.test(text)).map(([k]) => k);
  const prior = SECTION_PRIORS.find((p) => p.re.test(section)) || null;
  const e = clamp(Number.isFinite(Number(energy)) ? Number(energy) : 0.5, 0, 1);

  let emotion;
  let why;
  if (hits.includes('sadness') && e < 0.65) { emotion = 'sadness'; why = 'the words carry loss and the music pulls back'; }
  else if (hits.includes('anger') && e >= 0.5) { emotion = 'anger'; why = 'the words push back and the track is hitting hard'; }
  else if (hits.includes('power') && e >= 0.45) { emotion = 'power'; why = 'the words claim strength over a driving beat'; }
  else if (hits.includes('defiance')) { emotion = 'defiance'; why = 'the words refuse to follow the rules'; }
  else if (hits.includes('playful')) { emotion = e >= 0.75 ? 'euphoria' : 'playful'; why = 'the words are cheeky and funny'; }
  else if (hits.includes('intimacy') && e < 0.6) { emotion = 'intimacy'; why = 'the words are personal and close'; }
  else if (hits.includes('longing')) { emotion = 'longing'; why = 'the words reach for something out of reach'; }
  else if (hits.includes('euphoria')) { emotion = 'euphoria'; why = 'the words are a call to celebrate'; }
  else if (prior) { emotion = prior.emotion; why = `it is the ${section.toLowerCase() || 'section'} of the song`; }
  else if (e >= 0.7) { emotion = 'euphoria'; why = 'the music is at its loudest'; }
  else if (e <= 0.3) { emotion = 'tension'; why = 'the music is quiet and holding back'; }
  else { emotion = 'playful'; why = 'the groove is steady and light'; }

  // Loud final hooks and big choruses become the release the video builds to.
  if (prior?.emotion === 'release' && e >= 0.6 && ['euphoria', 'playful', 'power'].includes(emotion)) {
    emotion = 'release'; why = 'it is the last hook: everything the video built up lets go';
  }

  const base = 2 + e * 7 + (prior?.boost || 0) + (sung ? 0.3 : 0);
  const intensity = Math.round(clamp(base, 1, 10));
  return { emotion, intensity, why };
}

/**
 * Shape a whole video like a human editor would: the feeling should build,
 * not sit flat, and the final hook is the peak.
 */
export function shapeArc(items) {
  const out = items.map((x) => ({ ...x }));
  let run = 0;
  for (let i = 1; i < out.length; i += 1) {
    if (out[i].emotion === out[i - 1].emotion && out[i].intensity === out[i - 1].intensity) {
      run += 1;
      // Three identical beats in a row feel flat: lift the next one a notch.
      if (run >= 2) { out[i].intensity = clamp(out[i].intensity + 1, 1, 10); run = 0; }
    } else run = 0;
  }
  const peak = Math.max(...out.map((x) => x.intensity), 1);
  const lastRelease = out.map((x) => x.emotion).lastIndexOf('release');
  if (lastRelease >= 0) out[lastRelease].intensity = Math.max(out[lastRelease].intensity, Math.min(10, peak + 1));
  return out;
}

/** The camera a human director would choose for this feeling. */
export function cameraFor(emotion, { sung = false } = {}) {
  const e = EMOTIONS[emotion] || EMOTIONS.playful;
  return { ...(sung ? e.sung : e.broll) };
}

/**
 * Direction text for the generation prompt. Sung shots keep the face clear
 * for lip sync, so their cues are about expression, not big body moves.
 */
export function emotionCues(emotion, intensity = 6, { sung = false } = {}) {
  const e = EMOTIONS[emotion];
  if (!e) return '';
  const level = intensity >= 8 ? 'at full intensity' : intensity >= 5 ? 'clearly' : 'subtly';
  const parts = [
    `The audience should feel ${e.viewer}; play it ${level}`,
    `performers: ${e.performance}`,
    sung ? null : e.crowd,
    `light: ${e.light}`,
    `colour: ${e.grade}`,
  ];
  return parts.filter(Boolean).join('; ');
}

/** One-line note for the scene card, in the Director's voice. */
export function emotionNote({ emotion, intensity, why }) {
  const e = EMOTIONS[emotion];
  if (!e) return '';
  return `Feeling: ${e.label} ${intensity}/10. Viewers should feel ${e.viewer}${why ? `, because ${why}` : ''}.`;
}

/** Short performance phrase for the singing model (strict prompt limit). */
export function performWords(emotion) {
  return EMOTIONS[emotion]?.perform || 'with emotion';
}
