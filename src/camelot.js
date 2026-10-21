// Camelot key math shared by the browser page and the Node tools (plain ES module, no build step).
// A track's key is placed on the 12-hour Camelot clock: A = minor ring, B = major ring.
// From any key, three moves stay in key: stay (same code), step (one hour, same ring), flip (same hour, other ring).

const MINOR_HOUR = {'G#': 1, AB: 1, 'D#': 2, EB: 2, 'A#': 3, BB: 3, F: 4, 'E#': 4, C: 5, 'B#': 5, G: 6, D: 7, A: 8, E: 9, B: 10, CB: 10, 'F#': 11, GB: 11, 'C#': 12, DB: 12};
const MAJOR_HOUR = {B: 1, CB: 1, 'F#': 2, GB: 2, 'C#': 3, DB: 3, 'G#': 4, AB: 4, 'D#': 5, EB: 5, 'A#': 6, BB: 6, F: 7, 'E#': 7, C: 8, 'B#': 8, G: 9, D: 10, A: 11, E: 12, FB: 12};

/** Canonical key name for each Camelot code. */
export const CAMELOT_NAMES = {
  '1A': 'A♭ minor', '2A': 'E♭ minor', '3A': 'B♭ minor', '4A': 'F minor', '5A': 'C minor', '6A': 'G minor',
  '7A': 'D minor', '8A': 'A minor', '9A': 'E minor', '10A': 'B minor', '11A': 'F♯ minor', '12A': 'C♯ minor',
  '1B': 'B major', '2B': 'F♯ major', '3B': 'D♭ major', '4B': 'A♭ major', '5B': 'E♭ major', '6B': 'B♭ major',
  '7B': 'F major', '8B': 'C major', '9B': 'G major', '10B': 'D major', '11B': 'A major', '12B': 'E major',
};

/**
 * Parse a key label into a Camelot code. Accepts "F Minor", "Eb Minor", "D# minor", "Gb Major", "F#m",
 * "C#/Db minor" and Camelot codes like "4A". Returns null when the label has no clear mode.
 * @param {string | null | undefined} label
 * @returns {string | null}
 */
export function toCamelot(label) {
  if (!label) return null;
  const s = String(label).trim().replace(/♯/g, '#').replace(/♭/g, 'b');
  const code = s.match(/^(1[0-2]|[1-9])\s*([AB])$/i);
  if (code) return `${Number(code[1])}${code[2].toUpperCase()}`;
  const m = s.match(/^([A-Ga-g])\s*([#b]?)(?:\s*\/\s*[A-Ga-g][#b]?)?\s*([A-Za-z]*)/);
  if (!m) return null;
  const word = m[3];
  const minor = /^(minor|min)$/i.test(word) || word === 'm';
  const major = /^(major|maj)$/i.test(word) || word === 'M';
  if (!minor && !major) return null;
  const root = m[1].toUpperCase() + (m[2] === 'b' ? 'B' : m[2]);
  const hour = (minor ? MINOR_HOUR : MAJOR_HOUR)[root];
  return hour ? `${hour}${minor ? 'A' : 'B'}` : null;
}

/** @param {string} code */
function parts(code) { return {hour: parseInt(code, 10), ring: code.slice(-1)}; }

/**
 * Classify the move between two Camelot codes.
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {'stay' | 'step' | 'flip' | 'clash' | null} null when either key is unknown
 */
export function keyMove(a, b) {
  if (!a || !b) return null;
  if (a === b) return 'stay';
  const A = parts(a), B = parts(b);
  const d = Math.min((A.hour - B.hour + 12) % 12, (B.hour - A.hour + 12) % 12);
  if (A.ring === B.ring && d === 1) return 'step';
  if (A.ring !== B.ring && d === 0) return 'flip';
  return 'clash';
}

/** @param {string | null} move */
export function isLegalMove(move) { return move === 'stay' || move === 'step' || move === 'flip'; }

/**
 * Stores often list bass music at half time (70-99). Double those so tempos compare.
 * @param {number | null | undefined} bpm
 */
export function fullTimeBpm(bpm) {
  if (bpm == null || !Number.isFinite(bpm) || bpm <= 0) return null;
  return bpm < 100 ? bpm * 2 : bpm;
}

/**
 * Percent tempo difference between two tracks, measured from the slower one.
 * @param {number | null} a @param {number | null} b
 */
export function tempoGap(a, b) {
  const x = fullTimeBpm(a), y = fullTimeBpm(b);
  if (x == null || y == null) return null;
  return Math.abs(x - y) / Math.min(x, y) * 100;
}

/** Small seeded random number generator, so baselines are the same on every run. @param {number} seed */
export function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Score a set: how many adjacent pairs with both keys known are legal moves, against the same set shuffled.
 * `codes[i]` is the Camelot code at position i (null when unknown); `pairs` lists the adjacent positions that
 * were really played back to back (a gap in the tracklist has no pair).
 * The baseline shuffles the known keys among the known positions, keeping unknowns and gaps where they are.
 * @param {(string | null)[]} codes
 * @param {[number, number][]} pairs
 * @param {{iterations?: number, seed?: number}} [opts]
 */
export function scoreSet(codes, pairs, opts = {}) {
  const iterations = opts.iterations ?? 20000;
  const rand = mulberry32(opts.seed ?? 7);
  const scored = pairs.filter(([i, j]) => codes[i] && codes[j]);
  const legal = scored.filter(([i, j]) => isLegalMove(keyMove(codes[i], codes[j]))).length;
  const stays = scored.filter(([i, j]) => codes[i] === codes[j]).length;
  const knownPos = codes.map((c, i) => (c ? i : -1)).filter(i => i >= 0);
  const pool = knownPos.map(i => codes[i]);
  let sum = 0, atLeast = 0;
  const shuffled = codes.slice();
  for (let k = 0; k < iterations && scored.length; k++) {
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    knownPos.forEach((p, i) => { shuffled[p] = pool[i]; });
    let s = 0;
    for (const [i, j] of scored) if (isLegalMove(keyMove(shuffled[i], shuffled[j]))) s++;
    sum += s; if (s >= legal) atLeast++;
  }
  return {
    pairs: pairs.length,
    scored: scored.length,
    legal,
    stays,
    rate: scored.length ? legal / scored.length : null,
    shuffledRate: scored.length && iterations ? sum / iterations / scored.length : null,
    luck: scored.length && iterations ? atLeast / iterations : null,
  };
}
