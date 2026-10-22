import {artistKey} from './identity.ts';
import type {V2} from './store.ts';

/** Identity checks: each one is an audit finding that the v2 store must keep fixed. */
export function audit(data: V2): string[] {
  const fails: string[] = [];
  const byKey = new Map<string, string[]>();
  data.artists.forEach(a => byKey.set(artistKey(a), [...(byKey.get(artistKey(a)) ?? []), a]));
  const caseSplit = [...byKey.values()].filter(v => v.length > 1);
  if (caseSplit.length) fails.push(`artists split by case: ${JSON.stringify(caseSplit)}`);
  const quoted = data.artists.filter(a => /["]|,$/.test(a) || a !== a.trim());
  if (quoted.length) fails.push(`artist names with CSV debris: ${JSON.stringify(quoted)}`);
  const names = new Set(data.artists);
  const stripped = data.artists.filter(a => /^[a-z]/.test(a) && [...names].some(m => /^\d/.test(m) && m.replace(/^\d+/, '') === a));
  if (stripped.length) fails.push(`names missing their leading digits: ${JSON.stringify(stripped)}`);
  const ids = new Map<string, number>();
  data.tracks.forEach(r => ids.set(r[6], (ids.get(r[6]) ?? 0) + 1));
  const dupes = [...ids].filter(([, n]) => n > 1);
  if (dupes.length) fails.push(`tracks sharing an identity: ${dupes.length}`);
  const titles = data.tracks.filter(r => /^["']|["]$/.test(r[1]));
  if (titles.length) fails.push(`titles with CSV debris: ${titles.map(r => r[1]).join(', ')}`);
  const selfLoops = data.transitions.filter(([a, b]) => a === b).length;
  if (selfLoops) fails.push(`self transitions: ${selfLoops}`);
  const bad = data.transitions.filter(([a, b]) => !data.tracks[a] || !data.tracks[b]).length + data.selections.filter(([t]) => !data.tracks[t]).length;
  if (bad) fails.push(`observations pointing at missing tracks: ${bad}`);
  return fails;
}

