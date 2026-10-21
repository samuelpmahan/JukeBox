import test from 'node:test';
import assert from 'node:assert/strict';
import {toCamelot, keyMove, isLegalMove, fullTimeBpm, tempoGap, scoreSet, CAMELOT_NAMES} from './camelot.js';

test('key labels from Beatport, Tunebat and songbpm map to Camelot codes', () => {
  const cases: [string, string | null][] = [
    ['F Minor', '4A'], ['Eb Minor', '2A'], ['D# Minor', '2A'], ['Gb Major', '2B'], ['F# Major', '2B'],
    ['C# Major', '3B'], ['Db major', '3B'], ['A# Major', '6B'], ['B Minor', '10A'], ['B Major', '1B'],
    ['G#m', '1A'], ['C#/Db minor', '12A'], ['4A', '4A'], ['12b', '12B'], ['F♯ minor', '11A'],
    ['C#/Db', null], ['', null], ['H minor', null],
  ];
  for (const [label, code] of cases) assert.equal(toCamelot(label), code, label);
});

test('every Camelot code has a name and names round-trip', () => {
  assert.equal(Object.keys(CAMELOT_NAMES).length, 24);
  for (const [code, name] of Object.entries(CAMELOT_NAMES)) assert.equal(toCamelot(name), code, name);
});

test('moves: stay, step (including 12 to 1), flip, clash, unknown', () => {
  assert.equal(keyMove('4A', '4A'), 'stay');
  assert.equal(keyMove('4A', '5A'), 'step');
  assert.equal(keyMove('12A', '1A'), 'step');
  assert.equal(keyMove('1B', '12B'), 'step');
  assert.equal(keyMove('9A', '9B'), 'flip');
  assert.equal(keyMove('11A', '12B'), 'clash');
  assert.equal(keyMove('4A', '3B'), 'clash');
  assert.equal(keyMove(null, '4A'), null);
  assert.ok(isLegalMove('flip') && !isLegalMove('clash') && !isLegalMove(null));
});

test('half-time listings double; tempo gap is measured from the slower track', () => {
  assert.equal(fullTimeBpm(75), 150);
  assert.equal(fullTimeBpm(150), 150);
  assert.equal(fullTimeBpm(null), null);
  assert.equal(Math.round(tempoGap(72, 150)! * 10) / 10, 4.2);
});

test('set score counts only real back-to-back pairs with both keys, and the baseline is repeatable', () => {
  const codes = ['4A', '4A', null, '4A', '9B', '9A'];
  const pairs: [number, number][] = [[0, 1], [1, 2], [3, 4], [4, 5]]; // 2 -> 3 is a gap
  const a = scoreSet(codes, pairs, {iterations: 2000, seed: 1});
  const b = scoreSet(codes, pairs, {iterations: 2000, seed: 1});
  assert.equal(a.scored, 3);
  assert.equal(a.legal, 2);
  assert.equal(a.stays, 1);
  assert.deepEqual(a, b);
  assert.ok(a.shuffledRate! >= 0 && a.shuffledRate! <= 1);
});

test("Squnto's Lost Lands 2018 set reproduces the published score", () => {
  // Camelot codes for his 68 tracks in set order (null = no key found), from the keyed set file.
  const codes = ['2A','2A','7A',null,'5B','2A',null,'3B','4A','2A',null,null,null,null,'12A','8A','1B','2A','6B','2A','9A','2A','7B','7B','4A','4A','3B','4A','4A','4A','3B','4A','7B','4A','7B','9A','7B','11A','4A','4A','4A','4A','12B','4A','5A','8B',null,'10B','11A','2B','9A','11A','11A','11A','10A','7B','12A','12B','3B','11B',null,'3B','12B','4A','10B',null,null,null];
  const pairs = codes.slice(1).map((_, i) => [i, i + 1] as [number, number]);
  const s = scoreSet(codes, pairs, {iterations: 20000, seed: 7});
  assert.equal(s.scored, 51);
  assert.equal(s.legal, 13);
  assert.equal(s.stays, 10);
});
