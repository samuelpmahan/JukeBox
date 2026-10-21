// Repair the committed v1 primitive store without the raw corpus, applying the identity rules in src/identity.ts.
// Deterministic: the same v1 input always gives byte-identical v2 output (src/data.test.ts checks this).
//
//   node --experimental-strip-types scratch/migrate-v1-to-v2.ts [out.gz] [--map v1-to-identity.json]
//
// What it repairs (each one is an audit finding):
//   - CSV quoting leaked into names ("He$H, Bommer,) -> quotes stripped, comma lists split into people
//   - leading digits stripped as track numbers (th Planet, bit) -> restored from the full name seen elsewhere
//   - one artist split by letter case (SVDDEN DEATH / Svdden Death) -> merged
//   - one track split by any of the above or by ft. credits -> merged
// What it cannot repair: transitions that bridged an ID line. That needs the corpus and the v2 parser.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {artistKey, cleanName, trackIdentity} from '../src/identity.ts';

type V1 = {schema: string; meta: Record<string, unknown>; artists: string[]; tracks: [string, string, number[], number[], string | null, number[]][]; selectorGroups: [number[], string, number][]; dates: string[]; selections: number[][]; transitions: number[][]};

export function readParts(prefix: string): Buffer {
  const dir = path.dirname(prefix), base = path.basename(prefix);
  const parts = fs.readdirSync(dir).filter(f => f.startsWith(base + '.part')).sort();
  if (!parts.length) throw new Error(`no parts for ${prefix}`);
  return Buffer.concat(parts.map(f => fs.readFileSync(path.join(dir, f))));
}

export function migrate(v1gz: Buffer) {
  const v1 = JSON.parse(zlib.gunzipSync(v1gz).toString('utf8')) as V1;
  if (v1.schema !== 'jukebox-primitives/v1') throw new Error(`expected v1, got ${v1.schema}`);
  const sha = crypto.createHash('sha256').update(v1gz).digest('hex');

  // 1. Every v1 artist string becomes one or more cleaned names.
  const cleaned = v1.artists.map(a => cleanName(a).split(/\s*,\s*/).map(cleanName).filter(Boolean));
  const allNames = new Set(cleaned.flat());
  const renamed: [string, string][] = [];
  const restoreDigits = (n: string) => {
    if (!/^[a-z]/.test(n)) return n;
    for (const m of allNames) if (m !== n && /^\d/.test(m) && m.replace(/^\d+/, '') === n) { renamed.push([n, m]); return m; }
    return n;
  };
  const names = cleaned.map(list => list.map(restoreDigits));

  // 2. Pick one display spelling per artist key: selector labels first (curated file names), then most used.
  const selectorText = v1.selectorGroups.map(g => g[1]).join(' & ');
  const uses = new Map<string, number>();
  const bump = (ids: number[]) => ids.forEach(i => names[i].forEach(n => uses.set(n, (uses.get(n) ?? 0) + 1)));
  v1.tracks.forEach(r => { bump(r[2]); bump(r[3]); bump(r[5]); });
  const spellings = new Map<string, string[]>();
  names.flat().forEach(n => { const k = artistKey(n); const s = spellings.get(k) ?? []; if (!s.includes(n)) s.push(n); spellings.set(k, s); });
  const display = new Map<string, string>();
  const merged: string[][] = [];
  for (const [k, s] of spellings) {
    const pick = [...s].sort((a, b) => Number(selectorText.includes(b)) - Number(selectorText.includes(a)) || (uses.get(b) ?? 0) - (uses.get(a) ?? 0) || s.indexOf(a) - s.indexOf(b))[0];
    display.set(k, pick);
    if (s.length > 1) merged.push(s);
  }
  const artists = [...new Set([...display.values()])].sort((a, b) => a.localeCompare(b));
  const artistId = new Map(artists.map((a, i) => [artistKey(a), i]));
  const mapIds = (ids: number[]) => [...new Set(ids.flatMap(i => names[i].map(n => artistId.get(artistKey(n))!)))];

  // 3. Tracks merge on identity.
  const trackByIdentity = new Map<string, number>();
  const tracks: [string, string, number[], number[], string | null, number[], string][] = [];
  const v1ToV2: number[] = [];
  const titleCounts = new Map<string, number>();
  let tracksMerged = 0;
  v1.tracks.forEach(r => {
    const title = cleanName(r[1]).replace(/\s*\*+$/, '');
    const primary = mapIds(r[2]);
    const credits = mapIds(r[5]);
    const identity = trackIdentity(primary.map(i => artists[i]), title, r[4], credits.map(i => artists[i]));
    let id = trackByIdentity.get(identity);
    if (id === undefined) {
      const n = (titleCounts.get(title) ?? 0) + 1; titleCounts.set(title, n);
      id = tracks.length;
      tracks.push([`${title}#${String(n).padStart(3, '0')}`, title, primary, [], r[4], credits, identity]);
      trackByIdentity.set(identity, id);
    } else tracksMerged++;
    const row = tracks[id];
    row[3] = [...new Set([...row[3], ...mapIds(r[3])])].filter(x => !row[2].includes(x));
    v1ToV2.push(id);
  });

  // 4. Remap observations. A merge can turn A -> A' into a self-transition; those are dropped and counted.
  const selectorGroups = v1.selectorGroups.map(([m, label, truncated]) => [mapIds(m), label, truncated] as [number[], string, number]);
  const selections = v1.selections.map(([t, g, d]) => [v1ToV2[t], g, d]);
  let selfTransitionsDropped = 0;
  const transitions = v1.transitions.map(([a, b, g, d]) => [v1ToV2[a], v1ToV2[b], g, d]).filter(([a, b]) => (a === b ? (selfTransitionsDropped++, false) : true));

  const payload = {
    schema: 'jukebox-primitives/v2',
    meta: {
      ...v1.meta, tracks: tracks.length, artists: artists.length, selectionEvents: selections.length, transitionEvents: transitions.length,
      migratedFrom: {schema: v1.schema, sha256: sha},
      repairs: {
        digitsRestored: [...new Map(renamed.map(r => [r[0], r[1]])).entries()],
        quotedOrCommaNames: v1.artists.filter((a, i) => a !== cleanName(a) || cleaned[i].length > 1),
        caseMerged: merged,
        tracksMerged, selfTransitionsDropped,
      },
      trackRow: ['pk', 'title', 'primaryArtists', 'featuredArtists', 'variationType', 'variationArtists', 'identity'],
    },
    artists, tracks, selectorGroups, dates: v1.dates, selections, transitions,
  };
  const json = Buffer.from(JSON.stringify(payload));
  const gz = zlib.gzipSync(json, {level: 9});
  return {payload, gz, v1, v1ToV2Identity: v1ToV2.map(i => tracks[i][6])};
}

/** Write a gzip as 5000-byte binary-safe parts (the repo's transport format) and remove stale parts. */
export function writeParts(prefix: string, gz: Buffer) {
  const dir = path.dirname(prefix), base = path.basename(prefix);
  for (const f of fs.readdirSync(dir)) if (f.startsWith(base + '.part')) fs.unlinkSync(path.join(dir, f));
  for (let i = 0, n = 0; i < gz.length; i += 5000, n++) fs.writeFileSync(`${prefix}.part${String(n).padStart(2, '0')}`, gz.subarray(i, i + 5000));
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'data/lostlands-2018.v2.json.gz';
  const mapAt = process.argv.indexOf('--map');
  const {payload, gz, v1ToV2Identity} = migrate(readParts('data/lostlands-2018.jukebox.json.gz'));
  writeParts(out, gz);
  if (mapAt > 0) fs.writeFileSync(process.argv[mapAt + 1], JSON.stringify(v1ToV2Identity));
  const r = payload.meta.repairs;
  console.log(JSON.stringify({out, gzipBytes: gz.length, sha256: crypto.createHash('sha256').update(gz).digest('hex'), tracks: payload.tracks.length, artists: payload.artists.length,
    digitsRestored: r.digitsRestored, quotedOrCommaNames: r.quotedOrCommaNames, caseMerged: r.caseMerged.length, tracksMerged: r.tracksMerged, selfTransitionsDropped: r.selfTransitionsDropped}, null, 1));
}
