# Corpus experiment receipts

These are compact receipts from an actual execution over the local BigData415
archive. `run.json` defines the exact dataset hash, source scope, counts, methods,
and final statuses. Paths inside receipts refer to the original local execution;
the raw input, occurrence maps, complete pattern outputs, and token resolver are
intentionally not published here. Receipt hashes refer to those original local
materials, not to replacement or redacted files.

The input includes 1,222 byte-distinct nonempty sets, 43,941 ordered occurrences,
and 19,282 exact track strings. There are 15 additional byte-duplicate nonempty
members and 60 empty members. Byte deduplication does not remove every possible
alternate transcription of the same performance.

Interpretation:

- SQUISH is the authors' release with a path/entrypoint bridge. Its sequence
  count is checked against the corpus; its compressed model is a candidate
  summary, not a causal explanation.
- SKOPUS uses a minimum of 10 supporting sets per vocabulary item, top 10,
  maximum pattern length 3. ClaSP uses 1% minimum set support. Both mine
  subsequences with unrestricted gaps, and output support is independently
  scanned against original occurrences.
- Varying-order contrast is explicitly an EMM-inspired local screen, **not**
  an implementation or reproduction of the cited EMM algorithm. Its returned
  contrasts are exploratory and have no adjusted significance claim.
- The burst screen uses binomial set-presence likelihoods with a Kleinberg-style
  upward-transition penalty. Supplied filename dates define bins. A detected
  burst is not a verified release, crowd response, or claim about global trends.
- SUBDUE uses separate song-occurrence vertices labeled by exact track hashes,
  with directed edges confined to each set. Beam/expansion limits bound its
  exploration; a timeout carries no completed-discovery claim.

The LAB seam records input/parser bindings, named adapter source hashes,
per-method arguments, and Tick reads/writes. It is a small extraction seam for
future lab-common integration, not a complete general-purpose PxC engine.
