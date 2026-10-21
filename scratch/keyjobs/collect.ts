// Fold lookup outputs (JSON lines from record.mjs) into data/keys/lookups.json, keyed by track identity.
//   npm run keys:collect -- out/*.jsonl [--by haiku-mixgraph]
//   npm run keys:collect -- old/*.jsonl --v1-ids --by haiku-search   (rows that carry v1 track indexes as `id`)
// Re-runnable: a found key is never replaced by a miss, and when two sources disagree the more trusted one wins
// (beatport > mixgraph > tunebat > songbpm > other) and the other is kept under `alt`.
import fs from 'node:fs';
import {toCamelot} from '../../src/camelot.js';
import {LOOKUPS, V1_PREFIX, loadLookups, loadV2, readParts, type Lookup} from '../../src/store.ts';
import {migrate} from '../migrate-v1-to-v2.ts';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const by = flag('--by') ?? 'haiku-mixgraph';
const v1 = args.includes('--v1-ids'); if (v1) args.splice(args.indexOf('--v1-ids'), 1);

const TRUST = ['beatport', 'mixgraph', 'tunebat', 'songbpm', 'other'];
const normType = (t: string | null) => (t ? (TRUST.find(x => t.toLowerCase().startsWith(x)) ?? 'other') : null);
const UNCHECKED = /not searched|budget|rate.?limit|not checked|\b429\b|unverified|not looked up/i;

const d = loadV2();
const v1Identity = v1 ? migrate(readParts(V1_PREFIX)).v1ToV2Identity : null;
const store = loadLookups();
let added = 0, upgraded = 0, skipped = 0, kept = 0;

for (const file of args) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    const identity: string | undefined = v1Identity ? v1Identity[r.id] : d.tracks[r.track]?.[6];
    if (!identity) throw new Error(`${file}: no track for ${line}`);
    if (!r.key && UNCHECKED.test(r.note ?? '')) { skipped++; continue; }
    const next: Lookup = {key: r.key ?? null, camelot: toCamelot(r.key), bpm: r.bpm ?? null, source: r.source ?? null, sourceType: normType(r.sourceType), note: r.note ?? '', by: r.by ?? by};
    const cur = store.lookups[identity];
    if (!cur) { store.lookups[identity] = next; added++; continue; }
    if (!next.camelot && !next.bpm) { kept++; continue; }
    if (!cur.camelot && !cur.bpm) { store.lookups[identity] = next; upgraded++; continue; }
    if (cur.camelot === next.camelot && cur.source === next.source) { kept++; continue; }
    const [win, lose] = TRUST.indexOf(next.sourceType ?? 'other') < TRUST.indexOf(cur.sourceType ?? 'other') ? [next, cur] : [cur, next];
    const {alt: _a, ...loseFlat} = lose;
    store.lookups[identity] = {...win, alt: [...(win.alt ?? []), ...(lose.alt ?? []), loseFlat]};
    upgraded++;
  }
}

const sorted = Object.fromEntries(Object.entries(store.lookups).sort(([a], [b]) => a.localeCompare(b)));
fs.mkdirSync(new URL('../../data/keys/', import.meta.url), {recursive: true});
fs.writeFileSync(LOOKUPS, JSON.stringify({schema: 'jukebox-key-lookups/v1', lookups: sorted}, null, 1) + '\n');
const found = Object.values(sorted).filter(l => l.camelot).length;
console.log(JSON.stringify({added, upgraded, kept, skippedUnchecked: skipped, lookups: Object.keys(sorted).length, withKey: found, tracks: d.tracks.length}));
