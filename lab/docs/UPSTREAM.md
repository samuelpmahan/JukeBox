# Preparing the original miners

Keep upstream source, builds, and raw outputs outside Git (or in `lab/.tools/`).
Python 3.11+, a C++ compiler, Git, and Java 17 with a Java compiler are needed.
These dependencies are optional: unavailable providers emit explicit receipts.

## SPMF: SKOPUS and ClaSP

```bash
python3 lab/providers/setup_spmf.py
```

The setup checks out SPMF commit `ffda99181e8ffa71a51a41792c568931f8573d19`
and compiles only the original dependency closure and our small Java entrypoint.
No mining algorithm is rewritten. If `javac` is unavailable, supply an Eclipse
ECJ compiler jar using `--ecj /path/to/ecj.jar`. The verified build used ECJ 3.33.0
and Java 17. Override the output location with `--output`, and pass that location
through `JUKEBOX_SPMF_CLASSES` when running LAB. The build manifest records source
commit, bridge hash, and compiled class hashes.

The current upstream release jar needed a newer JVM than this workspace; this
source build avoids requiring a JVM upgrade. SPMF source is GPL-3.0; retain the
upstream license with any separately distributed builds.

SKOPUS defaults to the 10 highest-leverage patterns, maximum length 3, using
tracks occurring in at least 10 distinct sets. This is an explicit vocabulary
projection, not an exhaustive search over every possible song combination.
ClaSP defaults to 1% set support and the full vocabulary. Both use **unbounded
ordered subsequences** of singleton items. Neither result implies immediate
adjacency or audio mixing compatibility. Every output pattern's support is
independently recomputed against original local set sequences.

## SQUISH

Download the authors' release:
https://eda.rg.cispa.io/prj/squish/squish-v20180712.zip

Verify archive SHA-256:
`1696e4c01f0847b5cebfdb35ecdc457d444c935dc377540fb14c80b045f13b66`.
Keep that ZIP and set `JUKEBOX_SQUISH_ARCHIVE` to its path.
Extract outside Git and set `JUKEBOX_SQUISH_ROOT` to the directory containing
its C++ source. The provider creates a separate runtime build, changing only
hard-coded input paths and the entrypoint so LAB can supply its own input.
Inspect `lab/providers/squish_subdue.py` for the exact bridge patch. Archive
validation checks the ZIP; it does not independently attest an existing runtime
binary or a manually modified extraction. Rebuild from a fresh extraction when
changing upstream source. The original
algorithm and its licensing remain upstream; no upstream source is vendored.

## SUBDUE

```bash
git clone https://github.com/holderlb/Subdue.git /tmp/jukebox-subdue
git -C /tmp/jukebox-subdue checkout f33567dea2fa7e9595c27b807f16b120a7bdebb2
export JUKEBOX_SUBDUE_ROOT=/tmp/jukebox-subdue
```

This calls the upstream Python implementation. Beam width and expansion/size
limits are recorded experiment settings, not a claim of exhaustive discovery.

## Run and inspect

```bash
npm run lab -- --corpus /path/to/BigData415.zip --output lab/.runs/research
npm run test:lab
```

A timeout is a recorded incomplete experiment. A returned pattern is an observed
regularity, not evidence of hype, intent, influence, or causal adoption. Filename
dates are supplied metadata, not verified release or performance dates. Exact
byte deduplication does not establish independence of performances or selectors.
The compact committed receipts identify the experiment; ignored local artifacts
retain the detailed output needed to investigate it.
