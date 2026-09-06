const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const director = require('../lib/music-video-director.js');

test('music video demo director creates duration-matched sections and shots', () => {
  const project = { audioDurationSeconds: 60, bpmEstimate: 104, songSections: ['Intro', 'Verse', 'Chorus', 'Outro'], lyricsMode: 'official', lyricLines: [], videoStyle: 'Performance', visualDirection: {} };
  const sections = director.createSongSections(project);
  const shots = director.createLyricAwareShotPlan(project);
  assert.equal(sections.length, 4);
  assert.equal(shots.at(-1).endSeconds, 60);
  assert.ok(shots.every((shot, index) => shot.order === index + 1));
  assert.ok(shots.every((shot) => shot.lipSyncMode === 'eligible'));
});

test('music video instrumental plans block lip sync and never need audio bytes', () => {
  const project = { audioDurationSeconds: 45, songSections: ['Opening', 'Release'], lyricsMode: 'instrumental', visualDirection: {} };
  const shots = director.createInstrumentalShotPlan(project);
  assert.ok(shots.every((shot) => shot.lipSyncMode === 'none'));
  assert.equal(Object.prototype.hasOwnProperty.call(project, 'audioBytes'), false);
});

test('music routes and local-only safeguards are present', () => {
  for (const route of ['app/music-video/page.js', 'app/music-video/new/page.js', 'app/music-video/director/page.js', 'app/music-video/storyboard/page.js', 'app/music-video/review/page.js', 'app/music-video/projects/page.js']) {
    assert.equal(fs.existsSync(path.join(process.cwd(), route)), true, route);
  }
  const source = fs.readFileSync(path.join(process.cwd(), 'app/music-video/new/page.js'), 'utf8');
  assert.match(source, /rights/);
  assert.match(source, /demoModeEnabled/);
  assert.doesNotMatch(source, /fetch\(|\/api\//);
});
