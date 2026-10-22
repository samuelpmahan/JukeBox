// Jukebox on the command line. Reads only the committed data files.
//   npm run jukebox -- stats
//   npm run jukebox -- sets [--min 10]        key score per set, biggest lift first
//   npm run jukebox -- next "space laces torque"   what DJs played next, with key moves and tempo gaps
//   npm run jukebox -- audit                  identity checks on the data (exit 1 on a failure)
import {pathToFileURL} from 'node:url';
import {keyMove, isLegalMove, tempoGap, CAMELOT_NAMES} from './camelot.js';
import {audit} from './audit.ts';
import {displayTrack, loadKeys, loadV2} from './store.ts';

const [cmd = 'stats', ...rest] = process.argv.slice(2);
const d = loadV2();
const keys = loadKeys();
const keyOf = (t: number) => keys?.tracks[d.tracks[t][6]];
const pct = (x: number | null) => (x == null ? '   -' : `${Math.round(x * 100)}%`.padStart(4));

function stats() {
  console.log(`${d.meta.sourceFiles} sets, ${d.tracks.length} tracks, ${d.artists.length} artists, ${d.transitions.length} transitions`);
  if (keys) console.log(`keys: ${keys.meta.keyed} of ${keys.meta.tracks} tracks (${pct(keys.meta.coverage).trim()}), by source ${JSON.stringify(keys.meta.bySource)}`);
}

function sets() {
  if (!keys) { console.log('no key file yet: run npm run keys:build'); return; }
  const minAt = rest.indexOf('--min');
  const min = minAt >= 0 ? Number(rest[minAt + 1]) : 10;
  const rows = keys.sets.filter(s => s.all.scored >= min).sort((a, b) => ((b.all.rate ?? 0) - (b.all.shuffledRate ?? 0)) - ((a.all.rate ?? 0) - (a.all.shuffledRate ?? 0)));
  console.log(`${'set'.padEnd(44)} date        pairs legal  rate  shuffled  luck`);
  for (const s of rows) console.log(`${s.label.slice(0, 44).padEnd(44)} ${s.date ?? '          '}  ${String(s.all.scored).padStart(5)} ${String(s.all.legal).padStart(5)}  ${pct(s.all.rate)}      ${pct(s.all.shuffledRate)}  ${pct(s.all.luck)}`);
  console.log(`${rows.length} of ${keys.sets.length} sets have at least ${min} scored pairs.`);
}

function next() {
  const q = rest.join(' ').toLowerCase();
  if (!q) { console.log('usage: next <track or artist text>'); process.exitCode = 2; return; }
  const words = q.split(/\s+/).filter(Boolean);
  const hits = d.tracks.map((r, i) => [i, displayTrack(d, r)] as const).filter(([, s]) => words.every(w => s.toLowerCase().includes(w)))
    .sort((x, y) => x[1].length - y[1].length);
  if (!hits.length) { console.log(`no track matches "${q}"`); return; }
  const [t, name] = hits[0];
  const k = keyOf(t);
  console.log(`${name}  ${k?.[0] ? `${k[0]} ${CAMELOT_NAMES[k[0] as keyof typeof CAMELOT_NAMES]}` : 'key unknown'}${k?.[2] ? `  ${k[2]} BPM` : ''}`);
  const counts = new Map<number, number>();
  for (const [a, b] of d.transitions) if (a === t) counts.set(b, (counts.get(b) ?? 0) + 1);
  const rows = [...counts].sort((x, y) => y[1] - x[1]);
  if (!rows.length) console.log('  no recorded next track');
  for (const [b, n] of rows) {
    const kb = keyOf(b), m = keyMove(k?.[0], kb?.[0]), gap = tempoGap(k?.[2] ?? null, kb?.[2] ?? null);
    console.log(`  ${String(n).padStart(2)}x  ${(m ? (isLegalMove(m) ? m : 'clash') : '?').padEnd(5)} ${(kb?.[0] ?? '').padEnd(3)} ${gap == null ? '      ' : `${gap.toFixed(1)}%`.padStart(6)}  ${displayTrack(d, d.tracks[b])}`);
  }
  if (hits.length > 1) console.log(`(${hits.length - 1} more tracks match; be more specific)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
if (cmd === 'stats') stats();
else if (cmd === 'sets') sets();
else if (cmd === 'next') next();
else if (cmd === 'audit') {
  const fails = audit(d);
  if (fails.length) { fails.forEach(f => console.log(`FAIL ${f}`)); process.exitCode = 1; }
  else console.log(`audit passed: ${d.artists.length} artists, ${d.tracks.length} tracks, ${d.transitions.length} transitions, no identity splits or CSV debris`);
} else { console.log(`unknown command ${cmd}. Commands: stats, sets, next, audit`); process.exitCode = 2; }
}
