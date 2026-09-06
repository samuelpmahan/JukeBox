"""Shared, privacy-bounded runtime contract for JukeBox LAB methods."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import StrEnum
import csv
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import time
from typing import Any, Callable, Mapping
import zipfile

RECEIPT_SCHEMA = "jukebox-lab-receipt/v1"

class RunStatus(StrEnum):
    SUCCESS = "SUCCESS"
    NO_DATA = "NO_DATA"
    UNSUPPORTED = "UNSUPPORTED"
    FAILED = "FAILED"
    TIMED_OUT = "TIMED_OUT"

@dataclass(frozen=True, slots=True)
class SetRecord:
    """A local-only source set. `tracks` and `source_member` never enter receipts."""
    id: str
    selector: str
    date: str | None
    festival: str | None
    tracks: tuple[str, ...]
    source_member: str

@dataclass(frozen=True, slots=True)
class Corpus:
    input_path: Path
    input_sha256: str
    sets: tuple[SetRecord, ...]
    # Kept local for order-aware miners.  Receipts only contain aggregate summaries.
    ordered_occurrences: tuple[tuple[str, int, str], ...]
    nominal_csv_member_count: int = 0
    content_duplicate_count: int = 0
    empty_csv_member_count: int = 0
    empty_content_duplicate_count: int = 0
    source_scope: str = ""

@dataclass(slots=True)
class MethodResult:
    status: RunStatus
    summary: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    artifacts: list[str] = field(default_factory=list)
    algorithm_identity: str | None = None

@dataclass(frozen=True, slots=True)
class MethodAdapter:
    method_id: str
    algorithm_identity: str
    run: Callable[[Corpus, Mapping[str, Any]], MethodResult]
    description: str = ""

class MethodRegistry:
    def __init__(self) -> None:
        self._adapters: dict[str, MethodAdapter] = {}

    def register(self, adapter: MethodAdapter) -> None:
        if adapter.method_id in self._adapters:
            raise ValueError(f"duplicate LAB method: {adapter.method_id}")
        self._adapters[adapter.method_id] = adapter

    def get(self, method_id: str) -> MethodAdapter:
        return self._adapters[method_id]

    def ids(self) -> tuple[str, ...]:
        return tuple(self._adapters)

    def adapters(self) -> tuple[MethodAdapter, ...]:
        return tuple(self._adapters.values())

_DATE_PATTERN = re.compile(r"(20\d{2}-\d{2}-\d{2})")
_PRIMARY_PREFIX = "BigData415/Final/fests/"

def _parse_date(name: str) -> str | None:
    found = _DATE_PATTERN.search(name)
    if not found:
        return None
    try:
        return date.fromisoformat(found.group(1)).isoformat()
    except ValueError:
        return None

def _selector_from_member(member: str) -> str:
    # This keeps the historical corpus convention exactly, including `Alesso_12014...`.
    return PurePosixPath(member).name.split("_", 1)[0] or "Unknown"

def _festival_from_member(member: str) -> str | None:
    parts = PurePosixPath(member).parts
    try:
        return parts[parts.index("fests") + 1]
    except (ValueError, IndexError):
        return parts[-2] if len(parts) > 1 else None

def _tracks_from_csv(content: bytes) -> tuple[str, ...]:
    rows = csv.reader(io.TextIOWrapper(io.BytesIO(content), encoding="utf-8-sig", errors="replace", newline=""))
    # Preserve exact identity strings. Whitespace is used only to decide whether a row is blank.
    return tuple(row[0] for row in rows if len(row) == 1 and row[0].strip())

def read_zip_corpus(path: str | Path) -> Corpus:
    """Read the primary festival tree when present, otherwise all CSV playlist members.

    Duplicate byte-identical members collapse to one input set; the nominal count remains
    available for denominators and is included in every compact corpus summary.
    """
    input_path = Path(path).resolve()
    with input_path.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    sets: list[SetRecord] = []
    ordered: list[tuple[str, int, str]] = []
    with zipfile.ZipFile(input_path) as archive:
        names = [n for n in archive.namelist() if n.lower().endswith(".csv") and not n.startswith("__MACOSX/")]
        primary = [n for n in names if n.startswith(_PRIMARY_PREFIX)]
        members = sorted(primary if primary else names)
        scope = "BigData415/Final/fests/**/*.csv; content-deduplicated" if primary else "all CSV ZIP members; content-deduplicated"
        seen_nonempty_contents: set[str] = set()
        seen_empty_contents: set[str] = set()
        duplicate_count = 0
        empty_count = 0
        empty_duplicate_count = 0
        for member in members:
            content = archive.read(member)
            content_sha256 = hashlib.sha256(content).hexdigest()
            tracks = _tracks_from_csv(content)
            if not tracks:
                empty_count += 1
                if content_sha256 in seen_empty_contents:
                    empty_duplicate_count += 1
                else:
                    seen_empty_contents.add(content_sha256)
                continue
            if content_sha256 in seen_nonempty_contents:
                duplicate_count += 1
                continue
            seen_nonempty_contents.add(content_sha256)
            # Content digest makes the stable set ID independent of a mirrored ZIP path.
            set_id = content_sha256[:16]
            record = SetRecord(set_id, _selector_from_member(member), _parse_date(member),
                               _festival_from_member(member), tracks, member)
            sets.append(record)
            ordered.extend((set_id, ordinal, track) for ordinal, track in enumerate(tracks, start=1))
    return Corpus(input_path, digest, tuple(sets), tuple(ordered), len(members), duplicate_count,
                  empty_count, empty_duplicate_count, scope)

def compact_corpus_summary(corpus: Corpus) -> dict[str, Any]:
    dated = sum(1 for record in corpus.sets if record.date)
    return {"set_count": len(corpus.sets), "nominal_csv_member_count": corpus.nominal_csv_member_count,
            "content_duplicate_count": corpus.content_duplicate_count,
            "empty_csv_member_count": corpus.empty_csv_member_count,
            "empty_content_duplicate_count": corpus.empty_content_duplicate_count,
            "source_scope": corpus.source_scope, "ordered_occurrence_count": len(corpus.ordered_occurrences), "dated_set_count": dated,
            "festival_count": len({x.festival for x in corpus.sets if x.festival}),
            "selector_count": len({x.selector for x in corpus.sets if x.selector})}

def receipt_for(*, tick_id: str, adapter: MethodAdapter, corpus: Corpus, args: Mapping[str, Any],
                result: MethodResult, elapsed_ms: int) -> dict[str, Any]:
    return {"schema": RECEIPT_SCHEMA, "tick_id": tick_id, "method": adapter.method_id,
            "algorithm_identity": result.algorithm_identity or adapter.algorithm_identity,
            "input_sha256": corpus.input_sha256, "args": dict(args), "status": result.status.value,
            "timing_ms": elapsed_ms, "outputs": result.summary, "error": result.error,
            "artifacts": result.artifacts}

def run_adapter(*, tick_id: str, adapter: MethodAdapter, corpus: Corpus,
                args: Mapping[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        result = adapter.run(corpus, args)
        if not isinstance(result, MethodResult):
            raise TypeError(f"{adapter.method_id} returned {type(result).__name__}, not MethodResult")
    except TimeoutError as exc:
        result = MethodResult(RunStatus.TIMED_OUT, error=str(exc) or "method timeout")
    except Exception as exc:  # A failing method must not cancel the other requested runs.
        result = MethodResult(RunStatus.FAILED, error=f"{type(exc).__name__}: {exc}")
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    return receipt_for(tick_id=tick_id, adapter=adapter, corpus=corpus, args=args,
                       result=result, elapsed_ms=elapsed_ms)

def write_json(path: str | Path, value: Any) -> None:
    Path(path).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
