// Preview catalogue for the CineX Premieres "coming soon" page. These are
// sample titles made for the preview, not real uploads.

export const TABS = ['Popular', 'New', 'Hot', 'VIP', 'Ranking'];

export const SAMPLE_SERIES = [
  { slug: 'last-dragon-keep', likes: 412000, shares: 38900, unlockCredits: 299, title: "The Last Dragon's Keep", genre: 'Epic Fantasy', views: 6_700_000, isNew: false, hot: 92, vip: true, episodes: 12, logline: 'A disgraced knight rides alone to the mountain fortress where the last dragon guards a secret the kingdom buried.' },
  { slug: 'neon-crown', likes: 96400, shares: 21300, unlockCredits: 149, title: 'Neon Crown', genre: 'Music Drama', views: 491_800, isNew: true, hot: 98, vip: false, episodes: 8, logline: 'A bedroom producer has one night and one beat to win the city’s most dangerous rooftop battle.' },
  { slug: 'signal-lost', likes: 88100, shares: 9800, unlockCredits: 249, title: 'Signal Lost', genre: 'Sci-Fi', views: 745_600, isNew: true, hot: 81, vip: true, episodes: 10, logline: 'The last crew member of a silent station hears a voice that should not exist.' },
  { slug: 'midnight-verdict', likes: 41200, shares: 5600, unlockCredits: 199, title: 'Midnight Verdict', genre: 'Noir Mystery', views: 437_600, isNew: false, hot: 74, vip: false, episodes: 9, logline: 'A detective with nothing left to lose reopens the case that ended her career.' },
  { slug: 'tides-of-ember', likes: 133000, shares: 17400, unlockCredits: 249, title: 'Tides of Ember', genre: 'Adventure', views: 1_820_000, isNew: false, hot: 88, vip: true, episodes: 14, logline: 'A young captain steers a stolen ship straight into the storm everyone else is fleeing.' },
  { slug: 'cypher-district', likes: 74900, shares: 28700, unlockCredits: 99, title: 'Cypher District', genre: 'Dance', views: 287_800, isNew: true, hot: 95, vip: false, episodes: 6, logline: 'Four strangers, one subway platform and a dance-off that turns into a movement.' },
  { slug: 'paper-moon-kids', likes: 201000, shares: 12300, unlockCredits: 199, title: 'Paper Moon Kids', genre: 'Family', views: 2_350_000, isNew: false, hot: 70, vip: false, episodes: 20, logline: 'Two siblings follow a paper lantern into a forest where the fireflies keep the stars lit.' },
  { slug: 'iron-oath', likes: 23600, shares: 3100, unlockCredits: 149, title: 'Iron Oath', genre: 'Martial Arts', views: 180_700, isNew: true, hot: 84, vip: true, episodes: 7, logline: 'A wandering swordsman swore never to draw his blade again. Tonight the bamboo forest tests that oath.' },
  { slug: 'afterglow-tour', likes: 287000, shares: 44200, unlockCredits: 99, title: 'Afterglow: The Tour', genre: 'Music Doc', views: 3_100_000, isNew: false, hot: 90, vip: false, episodes: 5, logline: 'Behind the lights of the biggest independent tour of the year, made entirely by its fans.' },
];

export function formatViews(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

/** Order the catalogue for a tab, like the real feed will. */
export function seriesForTab(tab, list = SAMPLE_SERIES, query = '') {
  const q = query.trim().toLowerCase();
  let rows = q ? list.filter((s) => `${s.title} ${s.genre}`.toLowerCase().includes(q)) : [...list];
  if (tab === 'New') rows = rows.filter((s) => s.isNew);
  if (tab === 'VIP') rows = rows.filter((s) => s.vip);
  if (tab === 'Hot') rows.sort((a, b) => b.hot - a.hot);
  if (tab === 'Popular' || tab === 'Ranking') rows.sort((a, b) => b.views - a.views);
  return rows;
}

/** Popularity score for "Most loved" and trending rows: likes and shares weigh more than plays. */
export function popularity(s) {
  return s.views / 100 + s.likes * 3 + s.shares * 8;
}

export function mostLoved(list = SAMPLE_SERIES, n = 6) {
  return [...list].sort((a, b) => popularity(b) - popularity(a)).slice(0, n);
}
