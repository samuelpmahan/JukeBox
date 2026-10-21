#!/usr/bin/env node
// Append one key-lookup result as a JSON line. Lookup agents call this once per track.
//   node scratch/keyjobs/record.mjs OUTFILE TRACK KEY BPM URL SOURCE_TYPE [note...]
// TRACK is the track's index in the v2 primitive store (the `track` field of the batch file).
// Use the word null for anything not found.
import fs from 'node:fs';

const [out, track, key, bpm, url, sourceType, ...note] = process.argv.slice(2);
if (!out || track === undefined || sourceType === undefined) {
  console.error('usage: record.mjs OUTFILE TRACK KEY BPM URL SOURCE_TYPE [note...]');
  process.exit(2);
}
const nul = v => (v == null || /^(null|none|)$/i.test(v.trim()) ? null : v.trim());
const rec = {track: Number(track), key: nul(key), bpm: nul(bpm) == null ? null : Number(bpm), source: nul(url), sourceType: nul(sourceType), note: note.join(' ')};
if (!Number.isInteger(rec.track)) { console.error(`TRACK must be an integer, got ${track}`); process.exit(2); }
fs.appendFileSync(out, JSON.stringify(rec) + '\n');
console.log('recorded', rec.track, rec.key, rec.bpm);
