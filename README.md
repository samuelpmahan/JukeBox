# Jukebox

A revived TypeScript version of the 2018 graph recommender, currently focused on an inspectable local track graph / clickable set builder.

## Data boundary

Raw recovered tracklists are **not committed**. `corpus/` and `*.csv` are ignored.

`scratch/build-primitives.ts` consumes a local tracklist directory and emits a compact derived primitive store. The repository stores that gzip as binary-safe chunks under `data/lostlands-2018.jukebox.json.gz.part*`; the Pages build concatenates them, verifies gzip integrity and a pinned SHA-256, and serves the reconstructed gzip.

The primitive store contains:

- `artists`: canonical names
- `tracks`: track identity + original/featured/variation attribution
- `selectorGroups`: DJ set credits decomposed into individual members while retaining the sparse collaboration group
- `selections`: `(track, selectorGroup, date)` observations
- `transitions`: `(fromTrack, toTrack, selectorGroup, date)` observations

It deliberately does **not** emit raw source lines, URLs, set titles, or complete ordered tracklists. The browser loads the derived gzip and decompresses it with `DecompressionStream`.

Rebuild locally:

```bash
npm run build:primitives -- /path/to/local/corpus /tmp/lostlands-2018.jukebox.json.gz
split -b 5000 -d -a 2 /tmp/lostlands-2018.jukebox.json.gz data/lostlands-2018.jukebox.json.gz.part
```

## Graph lessons carried forward

- Do not render the corpus graph. Materialize a small local projection around the current track.
- The graph renderer is commodity machinery; Cytoscape owns pan/zoom/layout/selection.
- The semantic model remains richer than the visible graph.
- Presets choose useful projection sizes; advanced config remains exposed but hidden.
- `&` in a selector credit is decomposed: `Dirt Monkey & Jantsen` contributes to Dirt Monkey, Jantsen, and retains the sparse `[Dirt Monkey,Jantsen]` selector-group observation.
- Selector-neighbor coloring uses Jaccard overlap of **individual selecting artists** among only the visible nodes.
- Visible candidates receive spatially assigned glowing keyboard hints after each traversal; pressing the letter traverses to that node.

## LAB mining runner

`LAB` runs named research methods against a local ZIP and writes one compact receipt per method. It is intentionally separate from the browser graph and never adds the ZIP, raw track strings, source member paths, or ordered set lists to Git.

```bash
npm run lab -- --corpus /path/to/BigData415.zip --output lab-output/run-001
```

The runner invokes all six requested method adapters unless `--method <id>` is repeated to select a subset. Each receipt records a tick ID, input SHA-256, normalized arguments, method and algorithm identity, status, elapsed time, and compact outputs. Every requested adapter gets a receipt even if its upstream dependency is unavailable, fails, or times out; LAB does not replace an original algorithm with an unlabelled approximation.

The shared reader selects `BigData415/Final/fests/**/*.csv` when that tree exists, excludes the mirror tree, and collapses byte-identical **nonempty** playlist members. It reports empty CSV members separately from nonempty duplicate extras in the run manifest. Exact track fields and ordered occurrences remain local in memory; upstream methods that require files use the ignored `output/work/<method>/` directory.

Each run also makes a compact material path: `px.corpus → fn.<method> → px.results.<method>`, with `px.args.<method>` read by the function. `px.corpus` binds the local ZIP path and input SHA to the parser source hash and record schema; `fn.<method>` binds the adapter source hash and algorithm identity. The per-method Tick receipt records these reads and write, input SHA-256, arguments, status, duration, identity, and output summary. This is an extraction seam for a future shared LAB material engine, not a claim of a complete PxC runtime. `inspect/token-resolution.local.json` is a local-only raw-track resolver for the hash schemes used in compact results; it is never part of a receipt or commit.

Use `--config knobs.json` to set declared experimental parameters without changing code:

```json
{"all":{"max_patterns":25},"methods":{"skopus-original":{"top_k":20},"closed-sequential-spmf":{"min_support":0.01}}}
```

The EMM-inspired contrast and binned burst scores are descriptive empirical screens. They are neither sampled/held-out validation nor significance tests, and their receipts do not claim a p-value or discovery.

Available methods and labels:

- `squish-original` — original upstream SQUISH adapter when its local provider is prepared.
- `exceptional-transition-mining-varying-order` — an explicitly **EMM-inspired** varying-order transition contrast, not a claim of the original EMM implementation.
- `skopus-original` — original upstream SPMF SKOPUS process adapter.
- `closed-sequential-spmf` — upstream SPMF ClaSP closed sequential-pattern process adapter.
- `kleinberg-binned` — date-binned, set-presence Kleinberg-style dynamic program; it states the binned-model limitation in its receipt.
- `subdue-original` — original upstream Subdue adapter when its local provider is prepared.

Run the LAB-focused checks with `npm run test:lab`. Local output directories (`lab-output/`, `lab-work/`, and `lab/.tools/`) are ignored.

See [upstream setup and experiment scopes](lab/docs/UPSTREAM.md) and
[example method configuration](lab/example.config.json) for reproducible builds
and explicit mining parameters.
