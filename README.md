# Jukebox

A revived TypeScript version of the 2018 graph recommender, focused on an inspectable local track graph / clickable set builder, now with a harmonic layer: every track that has a known key carries its Camelot code, every transition is classified as a legal key move or a clash, and every set gets a key score.

```bash
npm test                 # unit tests + executable data audit (CI runs this before deploy)
npm run audit            # identity checks on the shipped store
npm run serve            # the page at http://localhost:8017, served like GitHub Pages
npm run jukebox -- stats
npm run jukebox -- next "space laces torque"   # what DJs played next, with key moves and tempo gaps
npm run jukebox -- sets --min 10               # key score per set, biggest lift first
```

Node 22.6+ (type stripping), no dependencies.

## Data boundary

Raw recovered tracklists are **not committed**. `corpus/` and `*.csv` are ignored.

`scratch/build-primitives.ts` consumes a local tracklist directory and emits a compact derived primitive store (schema v2) as binary-safe 5000-byte chunks under `data/lostlands-2018.v2.json.gz.part*`; the Pages build concatenates them, verifies gzip integrity and a pinned SHA-256, and serves the reconstructed gzip.

The primitive store contains:

- `artists`: canonical names (one per name ignoring case)
- `tracks`: `[pk, title, primary, featured, variationType, variationArtists, identity]`
- `selectorGroups`: DJ set credits decomposed into individual members while retaining the sparse collaboration group
- `selections`: `(track, selectorGroup, date)` observations
- `transitions`: `(fromTrack, toTrack, selectorGroup, date)` observations

It deliberately does **not** emit raw source lines, URLs, set titles, or complete ordered tracklists. The browser loads the derived gzip and decompresses it with `DecompressionStream`.

Rebuild from a local corpus (writes the v2 parts directly):

```bash
npm run build:primitives -- /path/to/local/corpus
```

### Where v2 came from

The corpus is not in the repo, so the shipped v2 store is a repair of the original v1 store (`data/lostlands-2018.jukebox.json.gz.part*`, still pinned): `npm run migrate:v2`. The migration is deterministic and `src/data.test.ts` checks that it reproduces the committed v2 bytes. A corpus rebuild replaces it (the test then skips itself).

## Key layer

- `src/camelot.js`: one plain ES module shared by the page and the Node tools. Parses key labels from Beatport, Mixgraph, Tunebat and songbpm (`F Minor`, `D# minor`, `Gb Major`, `F#m`, `4A`) into Camelot codes and classifies moves: **stay** (same code), **step** (one hour, same ring), **flip** (same hour, other ring), or **clash**.
- `data/keys/lookups.json`: every lookup result, keyed by track identity, with its source URL, source type and which job found it. A found key is never replaced by a miss; when sources disagree the more trusted one wins (beatport > mixgraph > tunebat > songbpm) and the other is kept under `alt`.
- `data/lostlands-2018.keys.json` (`npm run keys:build`): one key row per track, plus a score for every set: back-to-back pairs with both keys known, how many are legal moves, the same tracks shuffled 20,000 times (seed 7), and how often a shuffle scored as high. `all` uses every key; `store` uses only Beatport and Mixgraph keys, since Tunebat and songbpm read Spotify's estimates (which often say C♯ major where Beatport says F minor).

### Getting more keys

Lookups are jobs for small agents (Haiku is enough), run a batch at a time:

```bash
npm run keys:batches                 # scratch/keyjobs/batches/artists-NN.json for every track without a key
# give each agent scratch/keyjobs/INSTRUCTIONS.md, one batch file and one output file (three agents at a time)
npm run keys:collect -- out/*.jsonl  # fold results into data/keys/lookups.json
npm run keys:build                   # rebuild the key file and set scores
npm test                             # the data audit checks the key file matches the store and lookups
```

The Mixgraph route needs no web search: an artist page lists that artist's top 25 tracks with BPM and Camelot code, and track pages follow a guessable slug.

## What the audit fixed

Each item is a test in `src/parser.test.ts` or a check in `src/audit.ts`:

- `parseLine` removed leading digits as a track number, so **12th Planet became "th Planet"** (8 tracks) and **16bit became "bit"**. Only `01.` / `1)` / `[01]` count as track numbers now.
- CSV quoting leaked into names (`"He$H, Bommer,`, titles ending in `"`). Rows are unquoted and comma lists split into artists.
- Artists were split by case (SVDDEN DEATH / Svdden Death, JAUZ / Jauz, GRiZ / Griz, 10 pairs), splitting their tracks too.
- `Original Mix`, `Extended Mix` and `Radio Edit` would have parsed as remixes credited to artists named Original, Extended and Radio.
- **An `ID - ID` line was skipped and the tracks on either side were recorded as back to back.** The v2 parser records a gap instead. This one needs the corpus to repair in the shipped data, so until a rebuild the store still contains those bridged transitions (234 rejected lines in v1).
- `vs` without a period did not split artists.
- Track and artist names reached `innerHTML` unescaped.
- The keyboard-hint glow used `shadow-*` styles, which Cytoscape does not support, so it never rendered.
- `npm run jukebox` pointed at a `src/cli.ts` that did not exist.
- The Pages workflow deployed without running the tests.

## Graph lessons carried forward

- Do not render the corpus graph. Materialize a small local projection around the current track.
- The graph renderer is commodity machinery; Cytoscape owns pan/zoom/layout/selection.
- The semantic model remains richer than the visible graph.
- Presets choose useful projection sizes; advanced config remains exposed but hidden.
- `&` in a selector credit is decomposed: `Dirt Monkey & Jantsen` contributes to Dirt Monkey, Jantsen, and retains the sparse `[Dirt Monkey,Jantsen]` selector-group observation.
- Selector-neighbor coloring uses Jaccard overlap of **individual selecting artists** among only the visible nodes.
- Visible candidates receive spatially assigned glowing keyboard hints after each traversal; pressing the letter traverses to that node.
- Layout starts from fixed positions, so the same projection draws the same way every time.
- Key moves ride on top of observed transitions: the graph still shows what DJs actually played next, and the key layer says whether it was in key.
