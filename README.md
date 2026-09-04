# Jukebox

A revived TypeScript version of the 2018 graph recommender, currently focused on an inspectable local track graph / clickable set builder.

## Data boundary

Raw recovered tracklists are **not committed**. `corpus/` and `*.csv` are ignored.

`scratch/build-primitives.ts` consumes a local tracklist directory and emits `data/lostlands-2018.jukebox.json.gz`, a compact derived primitive store:

- `artists`: canonical names
- `tracks`: track identity + original/featured/variation attribution
- `selectorGroups`: DJ set credits decomposed into individual members while retaining the sparse collaboration group
- `selections`: `(track, selectorGroup, date)` observations
- `transitions`: `(fromTrack, toTrack, selectorGroup, date)` observations

It deliberately does **not** emit raw source lines, URLs, set titles, or complete ordered tracklists. The browser loads the gzip directly with `DecompressionStream`.

Rebuild locally:

```bash
npm run build:primitives -- /path/to/local/corpus data/lostlands-2018.jukebox.json.gz
```

## Graph lessons carried forward

- Do not render the corpus graph. Materialize a small local projection around the current track.
- The graph renderer is commodity machinery; Cytoscape owns pan/zoom/layout/selection.
- The semantic model remains richer than the visible graph.
- Presets choose useful projection sizes; advanced config remains exposed but hidden.
- `&` in a selector credit is decomposed: `Dirt Monkey & Jantsen` contributes to Dirt Monkey, Jantsen, and retains the sparse `[Dirt Monkey,Jantsen]` selector-group observation.
- Selector-neighbor coloring uses Jaccard overlap of **individual selecting artists** among only the visible nodes.
- Visible candidates receive spatially assigned glowing keyboard hints after each traversal; pressing the letter traverses to that node.
