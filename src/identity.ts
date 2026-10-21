// Identity rules: when two tracklist lines name the same artist or the same playable track.
// Every rule here answers one audit finding; src/identity.test.ts holds the cases.

/** Version text that names a format of the same recording, not a different playable track. */
const FORMAT_VERSION = /^(?:original|extended|radio|club|main|album|clean|dirty|explicit)(?:\s+(?:mix|edit|version))?$|^(?:original|extended|radio)$/i;

/** Strip CSV quoting and normalize spacing. `"Artist - Title"` -> `Artist - Title`, `""` -> `"`. */
export function unquoteCsv(line: string): string {
  let s = line.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) s = s.slice(1, -1);
  else if (s.startsWith('"') && !s.slice(1).includes('"')) s = s.slice(1);
  else if (s.endsWith('"') && !s.slice(0, -1).includes('"')) s = s.slice(0, -1);
  return s.replace(/""/g, '"').trim();
}

/** Display form of a name: Unicode-normalized, stray quotes and trailing commas removed, spaces collapsed. */
export function cleanName(s: string): string {
  return s.normalize('NFKC').replace(/^["'\s]+|["\s,]+$/g, '').replace(/\s+/g, ' ').trim();
}

/** Identity key for an artist: case and spacing do not make a different artist (SVDDEN DEATH = Svdden Death). */
export function artistKey(name: string): string {
  return cleanName(name).toLocaleLowerCase('en');
}

/** Identity key for a title. */
export function titleKey(title: string): string {
  return cleanName(title).replace(/\s*\*+$/, '').toLocaleLowerCase('en');
}

/** A version string that only names a format (Original Mix, Radio Edit) is the same track as no version. */
export function isFormatVersion(version: string | undefined): boolean {
  return !!version && FORMAT_VERSION.test(version.trim());
}

/** Split a credit into people. Joins: & , x × vs vs. b2b. (`and` is not a join: too many act names use it.) */
export function splitPeople(s: string): string[] {
  return s
    .split(/\s*,\s*|\s+(?:x|×|vs\.?|b2b)\s+|\s*&\s*/i)
    .map(cleanName)
    .filter(Boolean);
}

/** True for the unknown-track placeholders tracklists use. */
export function isUnknown(s: string | undefined): boolean {
  return !!s && /^(?:id|unknown|\?+)$/i.test(cleanName(s));
}

/**
 * Identity of a playable track: primary artists + title + variation (type and credited artists).
 * Featured credits are left out, because tracklists add or drop "ft." for the same recording.
 */
export function trackIdentity(primary: string[], title: string, variationType?: string | null, variationCredits: string[] = []): string {
  const people = (xs: string[]) => [...new Set(xs.map(artistKey))].sort().join('+');
  return [people(primary), titleKey(title), variationType ?? '', people(variationCredits)].join('|');
}
