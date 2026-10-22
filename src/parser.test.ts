import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLine, parseTracklist} from './parser.ts';
import {Jukebox} from './model.ts';
import {splitPeople, trackIdentity, unquoteCsv, isFormatVersion, artistKey} from './identity.ts';

const p = (line: string) => { const r = parseLine(line); assert.ok(r, `expected a track for ${line}`); return r; };

test('artist names that start with digits keep them (12th Planet, 16bit, 740 Boyz)', () => {
  assert.deepEqual(p('12th Planet & LUMBERJVCK - Skinny Pigs').primary, ['12th Planet', 'LUMBERJVCK']);
  assert.deepEqual(p('16bit - Chainsaw Calligraphy').primary, ['16bit']);
  assert.deepEqual(p('740 Boyz - Shimmy Shake').primary, ['740 Boyz']);
});

test('real track numbers are still removed', () => {
  assert.deepEqual(p('01. 12th Planet - Reckless').primary, ['12th Planet']);
  assert.deepEqual(p('7) Excision - Throwin Elbows').primary, ['Excision']);
  assert.deepEqual(p('[12] Zomboy - Invaders').primary, ['Zomboy']);
});

test('CSV-quoted rows lose their quotes, and commas join artists', () => {
  const r = p('"He$H, Bommer & Al Ross - The Good, The Bad, And The Gecko"');
  assert.deepEqual(r.primary, ['He$H', 'Bommer', 'Al Ross']);
  assert.equal(r.title, 'The Good, The Bad, And The Gecko');
  assert.equal(unquoteCsv('"Say ""Hi"" - Track"'), 'Say "Hi" - Track');
});

test('vs without a period joins artists too', () => {
  assert.deepEqual(p('Excision vs Wooli - Evil Twin').primary, ['Excision', 'Wooli']);
  assert.deepEqual(splitPeople('Malaa x Tchami'), ['Malaa', 'Tchami']);
});

test('format-only versions are the same track, and invent no artists', () => {
  for (const v of ['Original Mix', 'Extended Mix', 'Radio Edit', 'Club Mix']) {
    const r = p(`Excision - Throwin Elbows (${v})`);
    assert.equal(r.version, undefined, v);
    assert.equal(r.variation, undefined, v);
    assert.ok(isFormatVersion(v));
  }
  const j = new Jukebox();
  j.addTracklist(parseTracklist('Excision - Throwin Elbows (Original Mix)\nExcision - Throwin Elbows\nExcision - Throwin Elbows (Radio Edit)', 'DJ'));
  assert.equal(j.listTracks().length, 1);
  assert.deepEqual(j.listArtists().map(a => a.name), ['Excision']);
});

test('remixes stay distinct and keep their remixer', () => {
  const r = p('Zomboy - Like A Bitch (Kill The Noise Remix)');
  assert.deepEqual([r.variation?.type, r.variation?.creditArtists], ['REMIX', ['Kill The Noise']]);
  assert.notEqual(trackIdentity(['Zomboy'], 'Like A Bitch'), trackIdentity(['Zomboy'], 'Like A Bitch', 'REMIX', ['Kill The Noise']));
});

test('feat. in the title moves to featured credits and does not split the track', () => {
  const a = p('Riot Ten - Rail Breaker (feat. Rico Act)');
  assert.equal(a.title, 'Rail Breaker');
  assert.deepEqual(a.featured, ['Rico Act']);
  const j = new Jukebox();
  j.addTracklist(parseTracklist('Riot Ten - Rail Breaker (feat. Rico Act)\nRiot Ten ft. Rico Act - Rail Breaker\nRiot Ten - Rail Breaker', 'DJ'));
  assert.equal(j.listTracks().length, 1);
});

test('artist case does not split artists or tracks', () => {
  const j = new Jukebox();
  j.addTracklist(parseTracklist('Svdden Death - Behemoth\nSVDDEN DEATH - Behemoth', 'DJ'));
  assert.equal(j.listTracks().length, 1);
  assert.equal(j.listArtists().length, 1);
  assert.equal(artistKey('SVDDEN DEATH'), artistKey('Svdden Death'));
});

test('an ID between two tracks is a gap, not a transition', () => {
  const t = parseTracklist('A - One\nID - ID\nB - Two\nC - Three', 'DJ');
  assert.deepEqual([...t.breaksBefore], [1]);
  const j = new Jukebox();
  const e = j.addTracklist(t);
  assert.deepEqual(j.listTransitions().map(x => x.pk), ['Two->Three#001']);
  assert.ok(e.some(x => x.stage === 'GAP'));
});

test('an ID before the first track or after the last adds no gap', () => {
  const t = parseTracklist('ID - ID\nA - One\nB - Two\nID - ID', 'DJ');
  assert.deepEqual([...t.breaksBefore], []);
});

test('unknown artist with a known title is kept as a track without inventing an artist named ID', () => {
  const r = p("ID - Ashin' Blunts");
  assert.deepEqual(r.primary, []);
  assert.ok(r.signals.includes('ARTIST_UNKNOWN'));
});
