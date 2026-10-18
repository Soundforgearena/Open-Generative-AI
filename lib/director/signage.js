// Writing in the frame must read like real footage: signs, posters, menus,
// screens, papers and labels show real, correctly spelled words that make
// sense for the place, or nothing readable at all. Pure: shared by the
// browser prompt builder and the server still/video jobs.

export const SIGN_RULE_MARK = 'Writing in frame:';

// Short, real words a location would plausibly show. Order matters: the
// first match wins, so specific places come before generic ones.
const PLACE_WORDS = [
  [/\b(caribbean|jamaica|carnival|street party|block party|rum)\b/i, ['RUM BAR', 'OPEN', 'JERK CHICKEN']],
  [/\b(dancehall|night ?club|club|disco|rave)\b/i, ['LIVE MUSIC', 'BAR', 'OPEN']],
  [/\b(diner|restaurant|cafe|café|coffee)\b/i, ['CAFE', 'OPEN', 'MENU']],
  [/\b(hospital|clinic|emergency|ward)\b/i, ['EMERGENCY', 'EXIT']],
  [/\b(police|precinct|station house)\b/i, ['POLICE', 'EXIT']],
  [/\b(school|classroom|campus|university)\b/i, ['LIBRARY', 'EXIT']],
  [/\b(office|corporate|boardroom|reception)\b/i, ['RECEPTION', 'EXIT']],
  [/\b(gas station|petrol|garage)\b/i, ['GAS', 'OPEN']],
  [/\b(market|shop|store|mall|boutique)\b/i, ['OPEN', 'SALE']],
  [/\b(subway|metro|train|platform)\b/i, ['EXIT', 'TRAINS']],
  [/\b(street|city|downtown|alley|neighbou?rhood|bar)\b/i, ['OPEN', 'BAR', 'PHARMACY']],
];

const clean = (w) => String(w || '').replace(/[^\p{L}\p{N} &'!.-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24);

/** Creator-chosen sign words ("Act Normal Now, Rum Bar"), at most three. */
export function parseSignText(value) {
  return String(value || '').split(/[,\n;]/).map(clean).filter(Boolean).slice(0, 3);
}

/**
 * The words signs may show here: the creator's own words first, then words
 * that suit the place. Words already written into the prompt by the Studio
 * (Writing in frame: "X", "Y") are reused so the server keeps the same text.
 */
export function signWords(scenePrompt = '', signText = '') {
  const own = parseSignText(signText);
  if (own.length) return own;
  const marked = String(scenePrompt).match(/Writing in frame:[^.]*?((?:"[^"]{1,24}"(?:,\s*)?)+)/);
  if (marked) return [...marked[1].matchAll(/"([^"]{1,24})"/g)].map((m) => clean(m[1])).filter(Boolean).slice(0, 3);
  const hit = PLACE_WORDS.find(([re]) => re.test(scenePrompt));
  return hit ? hit[1] : ['OPEN'];
}

/** The rule every image and video prompt carries. */
export function textRule(words = ['OPEN']) {
  const list = words.map((w) => `"${w}"`).join(', ');
  return `${SIGN_RULE_MARK} any sign, poster, menu, screen, paper or label shows only these real, correctly spelled words: ${list}, in clean, simple lettering that fits the place. All other writing is out of focus, turned away or out of frame. Never invented letters, gibberish, mirrored or warped writing.`;
}

/** Motion prompts: writing must not melt or change while the camera moves. */
export const TEXT_MOTION_RULE = 'Any signs and writing stay exactly as in the first frame: sharp, unchanged and correctly spelled.';
