// Write lookup batches for every track that has no key yet, grouped by first artist (one Mixgraph artist page can
// answer several tracks), heaviest-played artists first.
//   npm run keys:batches -- [outDir] [--size 40]
import fs from 'node:fs';
import path from 'node:path';
import {loadLookups, loadV2} from '../../src/store.ts';

const args = process.argv.slice(2);
const sizeAt = args.indexOf('--size');
const size = sizeAt >= 0 ? Number(args.splice(sizeAt, 2)[1]) : 40;
const outDir = args[0] ?? 'scratch/keyjobs/batches';

const d = loadV2();
const {lookups} = loadLookups();
const weight = new Map<number, number>();
for (const [a, b] of d.transitions) { weight.set(a, (weight.get(a) ?? 0) + 1); weight.set(b, (weight.get(b) ?? 0) + 1); }
for (const [t] of d.selections) weight.set(t, (weight.get(t) ?? 0) + 1);

const slug = (s: string) => s.toLowerCase().replace(/&/g, ' ').replace(/\$/g, 's').replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const groups = new Map<string, {artist: string; artistSlug: string; weight: number; tracks: object[]}>();
d.tracks.forEach((row, track) => {
  if (lookups[row[6]] || !row[2].length) return; // already looked up (found or a checked miss), or no known artist
  const first = d.artists[row[2][0]];
  const g = groups.get(first) ?? {artist: first, artistSlug: slug(first), weight: 0, tracks: []};
  g.weight += weight.get(track) ?? 0;
  const names = (ids: number[]) => ids.map(i => d.artists[i]).join(' & ');
  g.tracks.push({track, artists: names(row[2]), featured: names(row[3]) || null, title: row[1], version: row[4] ? (row[4] === 'VIP' ? 'VIP' : `${names(row[5])} ${row[4][0]}${row[4].slice(1).toLowerCase()}`.trim()) : null});
  groups.set(first, g);
});

fs.mkdirSync(outDir, {recursive: true});
for (const f of fs.readdirSync(outDir)) if (/^artists-\d+\.json$/.test(f)) fs.unlinkSync(path.join(outDir, f));
const ordered = [...groups.values()].sort((a, b) => b.weight - a.weight || a.artist.localeCompare(b.artist));
let batch: typeof ordered = [], n = 0, count = 0, files = 0;
const flush = () => { if (!batch.length) return; files++; fs.writeFileSync(path.join(outDir, `artists-${String(files).padStart(2, '0')}.json`), JSON.stringify(batch.map(({weight: _w, ...g}) => g), null, 1)); batch = []; count = 0; };
for (const g of ordered) { batch.push(g); count += g.tracks.length; n += g.tracks.length; if (count >= size) flush(); }
flush();
console.log(JSON.stringify({tracksQueued: n, artists: ordered.length, batches: files, outDir}));
