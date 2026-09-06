"""Local-only token resolver for inspecting compact LAB receipts."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from lab.core import Corpus

_EMM_DOMAIN = b"jukebox-lab/emm-token/v1\0"

def write_local_token_resolver(corpus: Corpus, destination: str | Path) -> str:
    """Write raw-token mappings outside receipts, for a local analyst only.

    All listed mappings deliberately cover the algorithm-specific IDs used by current
    LAB adapters. This file is a local inspection aid and must remain in an ignored
    output directory.
    """
    tracks = sorted({track for record in corpus.sets for track in record.tracks})
    plain: dict[str, str] = {}
    squish_subdue: dict[str, str] = {}
    emm: dict[str, str] = {}
    for track in tracks:
        digest = hashlib.sha256(track.encode("utf-8", "surrogatepass")).hexdigest()
        plain[digest] = track
        plain[digest[:16]] = track
        squish_subdue["t_" + digest[:20]] = track
        emm["th_" + hashlib.sha256(_EMM_DOMAIN + track.encode("utf-8", "surrogatepass")).hexdigest()[:16]] = track
    payload: dict[str, Any] = {
        "schema": "jukebox-lab-local-token-resolver/v1",
        "input_sha256": corpus.input_sha256,
        "warning": "Contains raw track strings. Local inspection only; never commit or publish it.",
        "schemes": {
            "sha256-plain": plain,
            "squish-subdue-t-prefix": squish_subdue,
            "emm-domain-separated-th-prefix": emm,
        },
    }
    path = Path(destination)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return str(path)
