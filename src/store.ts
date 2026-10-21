// Load the committed data files from Node (tests, CLI, build scripts).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const V1_PREFIX = path.join(ROOT, 'data/lostlands-2018.jukebox.json.gz');
export const V2_PREFIX = path.join(ROOT, 'data/lostlands-2018.v2.json.gz');
export const LOOKUPS = path.join(ROOT, 'data/keys/lookups.json');
export const KEYS = path.join(ROOT, 'data/lostlands-2018.keys.json');

export type TrackRow = [pk: string, title: string, primary: number[], featured: number[], variationType: string | null, variationArtists: number[], identity: string];
export type V2 = {schema: 'jukebox-primitives/v2'; meta: Record<string, any>; artists: string[]; tracks: TrackRow[]; selectorGroups: [number[], string, number][]; dates: string[]; selections: [number, number, number][]; transitions: [number, number, number, number][]};
export type Lookup = {key: string | null; camelot: string | null; bpm: number | null; source: string | null; sourceType: string | null; note: string; by: string; alt?: Omit<Lookup, 'alt'>[]};
export type Lookups = {schema: 'jukebox-key-lookups/v1'; lookups: Record<string, Lookup>};
export type KeyRow = [camelot: string | null, keyLabel: string | null, bpm: number | null, sourceType: string | null, source: string | null];
export type SetScore = {group: number; label: string; date: string | null; tracks: number; keyed: number; all: Score; store: Score};
export type Score = {pairs: number; scored: number; legal: number; stays: number; rate: number | null; shuffledRate: number | null; luck: number | null};
export type Keys = {schema: 'jukebox-keys/v1'; meta: Record<string, any>; tracks: Record<string, KeyRow>; sets: SetScore[]};

export function readParts(prefix: string): Buffer {
  const dir = path.dirname(prefix), base = path.basename(prefix);
  const parts = fs.readdirSync(dir).filter(f => f.startsWith(base + '.part')).sort();
  if (!parts.length) throw new Error(`no parts for ${prefix}`);
  return Buffer.concat(parts.map(f => fs.readFileSync(path.join(dir, f))));
}

export const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
export const loadV2 = (): V2 => JSON.parse(zlib.gunzipSync(readParts(V2_PREFIX)).toString('utf8'));
export const loadLookups = (): Lookups => (fs.existsSync(LOOKUPS) ? JSON.parse(fs.readFileSync(LOOKUPS, 'utf8')) : {schema: 'jukebox-key-lookups/v1', lookups: {}});
export const loadKeys = (): Keys | null => (fs.existsSync(KEYS) ? JSON.parse(fs.readFileSync(KEYS, 'utf8')) : null);

/** Display text for a track row, with remixer names (the v1 page showed only "(REMIX)"). */
export function displayTrack(d: V2, row: TrackRow): string {
  const names = (ids: number[]) => ids.map(i => d.artists[i]).join(' & ');
  const v = row[4] ? ` (${row[4] === 'VIP' ? 'VIP' : `${names(row[5]) ? names(row[5]) + ' ' : ''}${row[4][0]}${row[4].slice(1).toLowerCase().replace('_', '-')}`})` : '';
  return `${names(row[2]) || 'Unknown artist'} - ${row[1]}${v}`;
}

/**
 * The sets in play order. Selections were written file by file, so each run of the same (selector group, date) is one
 * set. A pair of neighbours counts as back to back only when the store holds that transition.
 */
export function setsInOrder(d: V2) {
  const remaining = new Map<string, number>();
  for (const [a, b, g, t] of d.transitions) { const k = `${a}>${b}>${g}>${t}`; remaining.set(k, (remaining.get(k) ?? 0) + 1); }
  const sets: {group: number; date: number; tracks: number[]; pairs: [number, number][]}[] = [];
  for (const [track, group, date] of d.selections) {
    let cur = sets.at(-1);
    if (!cur || cur.group !== group || cur.date !== date) { cur = {group, date, tracks: [], pairs: []}; sets.push(cur); }
    const prev = cur.tracks.at(-1);
    cur.tracks.push(track);
    if (prev !== undefined) {
      const k = `${prev}>${track}>${group}>${date}`;
      const n = remaining.get(k) ?? 0;
      if (n > 0) { remaining.set(k, n - 1); cur.pairs.push([cur.tracks.length - 2, cur.tracks.length - 1]); }
    }
  }
  return sets;
}
