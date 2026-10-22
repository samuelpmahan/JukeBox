// Build data/lostlands-2018.keys.json from the lookups and the v2 store: one key row per track, and a key score for
// every set (legal key moves between back-to-back tracks, against the same set shuffled 20,000 times).
//   npm run keys:build
import fs from 'node:fs';
import {fullTimeBpm, scoreSet} from '../src/camelot.js';
import {KEYS, LOOKUPS, V2_PREFIX, loadLookups, loadV2, readParts, setsInOrder, sha256, type KeyRow, type SetScore} from '../src/store.ts';

const STORE_SOURCES = new Set(['beatport', 'mixgraph']);
const d = loadV2();
const {lookups} = loadLookups();

const tracks: Record<string, KeyRow> = {};
const bySource: Record<string, number> = {};
for (const row of d.tracks) {
  const l = lookups[row[6]];
  if (!l || (!l.camelot && l.bpm == null)) continue;
  tracks[row[6]] = [l.camelot, l.key, fullTimeBpm(l.bpm), l.sourceType, l.source];
  if (l.camelot) bySource[l.sourceType ?? 'other'] = (bySource[l.sourceType ?? 'other'] ?? 0) + 1;
}

const sets: SetScore[] = setsInOrder(d).map(s => {
  const codes = s.tracks.map(t => tracks[d.tracks[t][6]]?.[0] ?? null);
  const storeCodes = s.tracks.map(t => { const k = tracks[d.tracks[t][6]]; return k && STORE_SOURCES.has(k[3] ?? '') ? k[0] : null; });
  return {
    group: s.group, label: d.selectorGroups[s.group][1], date: s.date >= 0 ? d.dates[s.date] : null,
    tracks: s.tracks.length, keyed: codes.filter(Boolean).length,
    all: scoreSet(codes, s.pairs, {iterations: 20000, seed: 7}),
    store: scoreSet(storeCodes, s.pairs, {iterations: 20000, seed: 7}),
  };
});

const keyed = Object.values(tracks).filter(r => r[0]).length;
const payload = {
  schema: 'jukebox-keys/v1',
  meta: {
    tracks: d.tracks.length, keyed, coverage: keyed / d.tracks.length, bySource,
    lookupsSha256: sha256(fs.readFileSync(LOOKUPS)), primitivesSha256: sha256(readParts(V2_PREFIX)),
    legalMoves: 'stay = same Camelot code; step = one hour on the same ring; flip = same hour, other ring',
    baseline: 'known keys shuffled among known positions 20,000 times (seed 7); luck = share of shuffles scoring at least as high',
    keyRow: ['camelot', 'keyLabel', 'bpmFullTime', 'sourceType', 'source'],
  },
  tracks, sets,
};
// One set per line keeps diffs readable.
const json = JSON.stringify(payload).replace(/\},\{"group"/g, '},\n{"group"');
fs.writeFileSync(KEYS, json + '\n');
console.log(JSON.stringify({keyed, tracks: d.tracks.length, coverage: (keyed / d.tracks.length).toFixed(3), bySource, sets: sets.length, setsWithTenScoredPairs: sets.filter(s => s.all.scored >= 10).length}));
