import {Tracklist} from './model.ts';
import type {ParsedTrack, VariationType} from './model.ts';
import {cleanName, isFormatVersion, isUnknown, splitPeople, unquoteCsv} from './identity.ts';

const VARIATION_WORD = /\b(remix|rework|mashup|edit|re-burst|vip|flip|bootleg|mix|dub)\b/i;
const VARIATION_TYPES: Record<string, VariationType> = {remix: 'REMIX', rework: 'REWORK', mashup: 'MASHUP', edit: 'EDIT', 're-burst': 'RE_BURST', vip: 'VIP', flip: 'FLIP', bootleg: 'BOOTLEG', mix: 'MIX', dub: 'DUB'};
// A track number is digits followed by "." or ")" (or wrapped in [ ]). "12th Planet" and "16bit" are names, not numbers.
const TRACK_NUMBER = /^\s*(?:\d{1,3}\s*[.)]|\[\d{1,3}\])\s*/;
const FEAT_IN_ARTIST = /^(.*?)\s+(?:ft\.?|feat\.?|featuring)\s+(.+)$/i;
const FEAT_IN_TITLE = /\s*[([](?:ft\.?|feat\.?|featuring)\s+([^)\]]+)[)\]]/i;

function variationType(text: string): VariationType | undefined {
  const m = text.match(VARIATION_WORD)?.[1]?.toLowerCase();
  return m ? VARIATION_TYPES[m] ?? 'OTHER' : undefined;
}

function parseVariation(version: string | undefined, primary: string[]) {
  if (!version) return undefined;
  const type = variationType(version);
  if (!type) return undefined;
  if (type === 'VIP') return {type, creditArtists: [...primary], sourceText: version};
  const suffix = version.match(/^(.*?)\s+(Remix|Rework|Mashup|Edit|Re-burst|Flip|Bootleg|Mix|Dub)$/i);
  return {type, creditArtists: suffix ? splitPeople(suffix[1]) : [], sourceText: version};
}

/** Parse one tracklist line. Returns null for lines that are not a known track (blank, no "Artist - Title", or an ID). */
export function parseLine(line: string): ParsedTrack | null {
  const clean = unquoteCsv(line).replace(TRACK_NUMBER, '').trim();
  if (!clean || !clean.includes(' - ')) return null;
  const [artistText, ...rest] = clean.split(' - ');
  let rawTitle = rest.join(' - ').trim();
  if (!artistText.trim() || !rawTitle || isUnknown(rawTitle) || /\s-\sID(?:\s|$)/i.test(` - ${rawTitle}`)) return null;

  const signals: string[] = [];
  const feat = artistText.match(FEAT_IN_ARTIST);
  const primaryText = (feat?.[1] ?? artistText).trim();
  const featured = feat?.[2] ? splitPeople(feat[2]) : [];
  const titleFeat = rawTitle.match(FEAT_IN_TITLE);
  if (titleFeat) { featured.push(...splitPeople(titleFeat[1])); rawTitle = rawTitle.replace(FEAT_IN_TITLE, '').trim(); }

  const unknownArtist = isUnknown(primaryText);
  const primary = unknownArtist ? [] : splitPeople(primaryText);
  if (unknownArtist) signals.push('ARTIST_UNKNOWN');

  const paren = rawTitle.match(/^(.*?)\s*[([]([^()[\]]*)[)\]]\s*\*?$/);
  const title = cleanName((paren?.[1] ?? rawTitle).replace(/\s+\*$/, ''));
  let version = paren?.[2]?.trim() || undefined;
  if (isFormatVersion(version)) { signals.push(`VERSION_FORMAT_DROPPED: ${version}`); version = undefined; }
  const variation = parseVariation(version, primary);

  const assumptions = [
    'artist names are unique ignoring case',
    '& , x vs. b2b join primary artists',
    'ft./feat. marks featured credit, in the artist or the title',
    'parenthetical text names a playable version unless it only names a format (Original Mix, Radio Edit)',
    ...(variation ? [`${variation.type} is a VariationType`] : version ? ['version kind is not interpreted'] : []),
  ];
  if (version && !variation) signals.push(`VERSION_UNINTERPRETED: ${version}`);
  if (version?.includes('/')) signals.push(`VERSION_COMPOSITE: ${version}`);
  if (variation && variation.type !== 'VIP' && variation.creditArtists.length === 0) signals.push(`VARIATION_ATTRIBUTION_UNRESOLVED: ${version}`);
  return {source: line, artistText, title, version, primary, featured, variation, assumptions, signals};
}

/**
 * Parse a whole tracklist. A line that is not a known track (an ID, an unparseable row) is a gap:
 * the tracks on either side of it were not played back to back, so no transition joins them.
 */
export function parseTracklist(text: string, playedBy = 'Unknown'): Tracklist {
  const entries: ParsedTrack[] = [];
  const rejected: string[] = [];
  const breaksBefore: number[] = [];
  let pendingGap = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const p = parseLine(line);
    if (p) {
      if (pendingGap && entries.length) breaksBefore.push(entries.length);
      entries.push(p);
      pendingGap = false;
    } else {
      rejected.push(line);
      pendingGap = true;
    }
  }
  return new Tracklist(playedBy, entries, rejected, breaksBefore);
}
