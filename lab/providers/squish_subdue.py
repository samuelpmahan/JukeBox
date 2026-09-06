"""Adapters for the authors' SQUISH and SUBDUE implementations.

No upstream source or datasets are committed.  SQUISH is fetched/built only in the
local `upstream/` workspace because its released C++ program has a hard-coded
research-machine input path.  The small local build patch changes only that path
and its fixed `main` invocation; it does not change the mining algorithm.
"""
from __future__ import annotations

from collections.abc import Mapping
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from typing import Any

from lab.core import Corpus, MethodAdapter, MethodResult, RunStatus

SQUISH_URL = "https://eda.rg.cispa.io/prj/squish/squish-v20180712.zip"
SQUISH_SHA256 = "1696e4c01f0847b5cebfdb35ecdc457d444c935dc377540fb14c80b045f13b66"
SQUISH_IDENTITY = (
    "SQUISH authors' C++ release v20180712 (Apratim Bhattacharyya; "
    "official EDA archive sha256=" + SQUISH_SHA256 + ")"
)
SUBDUE_COMMIT = "f33567dea2fa7e9595c27b807f16b120a7bdebb2"
SUBDUE_IDENTITY = (
    "SUBDUE v1.4 Python (Larry Holder / Washington State University; "
    "holderlb/Subdue@" + SUBDUE_COMMIT + ")"
)


def _default_upstream(name: str) -> Path:
    # JukeBox/lab/providers -> scratch/JukeBox -> scratch/upstream.
    return Path(__file__).resolve().parents[3] / "upstream" / name


def _workdir(config: Mapping[str, Any], method: str) -> Path:
    configured = config.get("workdir")
    if not configured:
        raise ValueError("LAB provider requires config['workdir']")
    path = Path(str(configured)).resolve() / method
    path.mkdir(parents=True, exist_ok=True)
    return path


def _timeout(config: Mapping[str, Any]) -> float:
    try:
        return max(1.0, float(config.get("timeout_seconds", 120)))
    except (TypeError, ValueError) as exc:
        raise ValueError("timeout_seconds must be numeric") from exc


def _artifact(path: Path, workdir: Path) -> str:
    """Receipt paths are relative to the configured ignored LAB work directory."""
    return str(path.relative_to(workdir.parent))


def _digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def _token(track: str) -> str:
    # This token is safe for an ignored local artifact and receipt-derived aggregate.
    return "t_" + hashlib.sha256(track.encode("utf-8")).hexdigest()[:20]


def _symbol_table(corpus: Corpus) -> dict[str, int]:
    # Numeric IDs are required by the authors' SQUISH parser. Sorting makes them stable.
    return {track: index for index, track in enumerate(sorted({
        track for record in corpus.sets for track in record.tracks
    }), start=1)}


def _run(command: list[str], *, cwd: Path, timeout: float, output: Path) -> tuple[int, bool]:
    try:
        completed = subprocess.run(command, cwd=cwd, text=True, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        text = exc.stdout or ""
        if isinstance(text, bytes):
            text = text.decode("utf-8", "replace")
        output.write_text(text, encoding="utf-8")
        return 124, True
    output.write_text(completed.stdout, encoding="utf-8")
    return completed.returncode, False


def _validate_squish_source(source: Path, config: Mapping[str, Any]) -> str | None:
    archive = Path(str(config.get("squish_archive", os.environ.get(
        "JUKEBOX_SQUISH_ARCHIVE", source.parents[1] / "squish-v20180712.zip")))).resolve()
    if not archive.is_file():
        return f"SQUISH source pin cannot be verified: official archive is unavailable at {archive}"
    try:
        actual = _digest(archive)
    except OSError as exc:
        return f"SQUISH source pin cannot be read: {type(exc).__name__}: {exc}"
    if actual != SQUISH_SHA256:
        return f"SQUISH archive SHA-256 mismatch: expected {SQUISH_SHA256}, got {actual}"
    return None


def _validate_subdue_source(source: Path) -> str | None:
    if not (source / ".git").exists():
        return "SUBDUE source pin cannot be verified: missing .git metadata"
    try:
        head = subprocess.run(["git", "-C", str(source), "rev-parse", "HEAD"], text=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5, check=False)
        dirty = subprocess.run(["git", "-C", str(source), "status", "--porcelain", "--untracked-files=no"], text=True,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return f"SUBDUE source pin cannot be verified: {type(exc).__name__}: {exc}"
    if head.returncode != 0 or dirty.returncode != 0:
        return "SUBDUE source pin cannot be verified with git"
    revision = head.stdout.strip()
    if revision != SUBDUE_COMMIT:
        return f"SUBDUE revision mismatch: expected {SUBDUE_COMMIT}, got {revision or 'none'}"
    if dirty.stdout.strip():
        return "SUBDUE source tree is dirty"
    return None


def _prepare_squish_runtime(source: Path, timeout: float) -> tuple[Path | None, str | None]:
    """Build an external working copy with only a path/CLI bridge around SQUISH."""
    if not source.is_dir():
        return None, f"SQUISH source is unavailable at {source}; expected official archive {SQUISH_URL}"
    runtime = source.parent / "squish-runtime"
    binary = runtime / "squish"
    if binary.is_file() and os.access(binary, os.X_OK):
        return binary, None
    try:
        if not runtime.exists():
            shutil.copytree(source, runtime)
        search = runtime / "sqs" / "new_search.cpp"
        main = runtime / "src" / "main.cpp"
        text = search.read_text(encoding="utf-8")
        before = '"/home/abhattac/git/serial_episodes/" + type + "_datasets/" + dataset_name'
        if before in text:
            text = text.replace(before, 'type + "/" + dataset_name')
            search.write_text(text, encoding="utf-8")
        main.write_text(
            '#include <iostream>\n#include "../sqs/new_search.h"\n'
            'int main(int argc, char **argv) {\n'
            '  if (argc < 3 || argc > 4) { std::cerr << "usage: squish <input-dir> <dataset-stem> [labels]\\n"; return 2; }\n'
            '  return sqs_search_ditto(argv[1], argv[2], argc == 4 && std::string(argv[3]) == "labels");\n'
            '}\n', encoding="utf-8")
        command = ["g++", "-O2", "-std=c++17", "-fopenmp", "src/main.cpp", "ditto/encode.cpp",
                   *[str(x.relative_to(runtime)) for x in sorted((runtime / "misc").glob("*.cpp"))],
                   *[str(x.relative_to(runtime)) for x in sorted((runtime / "sqs").glob("*.cpp"))], "-o", "squish"]
        build_log = runtime / "build.log"
        rc, timed_out = _run(command, cwd=runtime, timeout=timeout, output=build_log)
        if timed_out:
            return None, "SQUISH build timed out"
        if rc != 0 or not binary.is_file():
            return None, f"SQUISH build failed (exit {rc}); see {build_log}"
        return binary, None
    except (OSError, UnicodeError) as exc:
        return None, f"SQUISH local bridge could not be prepared: {type(exc).__name__}: {exc}"


def run_squish(corpus: Corpus, config: Mapping[str, Any]) -> MethodResult:
    """Run the original SQUISH code on all ordered sets using opaque local symbols."""
    if not corpus.ordered_occurrences:
        return MethodResult(RunStatus.NO_DATA, {"set_count": len(corpus.sets)}, algorithm_identity=SQUISH_IDENTITY)
    workdir = _workdir(config, "squish")
    source = Path(str(config.get("squish_root", os.environ.get("JUKEBOX_SQUISH_ROOT", _default_upstream("squish/squish"))))).resolve()
    pin_error = _validate_squish_source(source, config)
    if pin_error:
        return MethodResult(RunStatus.UNSUPPORTED, error=pin_error, algorithm_identity=SQUISH_IDENTITY)
    binary, unavailable = _prepare_squish_runtime(source, _timeout(config))
    if unavailable:
        return MethodResult(RunStatus.UNSUPPORTED, error=unavailable, algorithm_identity=SQUISH_IDENTITY)
    assert binary is not None
    symbols = _symbol_table(corpus)
    input_path = workdir / "input.dat"
    labels_path = workdir / "input.lab"
    # The original Data parser treats every comma as a completed item and '-,' as a boundary.
    nonempty_sets = [record for record in corpus.sets if record.tracks]
    with input_path.open("w", encoding="ascii") as destination:
        for index, record in enumerate(nonempty_sets):
            destination.write("".join(f"{symbols[track]}," for track in record.tracks))
            # Data starts at one sequence and increments at each boundary.  Do not
            # emit a final boundary or it creates one empty sequence.
            if index + 1 < len(nonempty_sets):
                destination.write("-,")
    labels_path.write_text("__boundary__\n" + "\n".join(
        _token(track) for track, _ in sorted(symbols.items(), key=lambda pair: pair[1])
    ) + "\n", encoding="ascii")
    output = workdir / "output.txt"
    rc, timed_out = _run([str(binary), str(workdir), "input", "labels"], cwd=workdir,
                         timeout=_timeout(config), output=output)
    output_text = output.read_text(encoding="utf-8", errors="replace")
    sequence_match = re.search(r"^Num of seq: (\d+)$", output_text, re.M)
    codelen_match = re.search(r"^Final codelen: ([^\n]+)$", output_text, re.M)
    summary = {"set_count": len(corpus.sets), "symbol_count": len(symbols),
               "sequence_count": len(nonempty_sets),
               "reported_sequence_count": int(sequence_match.group(1)) if sequence_match else None,
               "final_model_codelen": float(codelen_match.group(1)) if codelen_match else None,
               "output_sha256": _digest(output),
               "reported_choice_pattern_count": len(re.findall(r"^codelen:", output_text, re.M))}
    if timed_out:
        return MethodResult(RunStatus.TIMED_OUT, summary, "SQUISH execution timed out", [_artifact(input_path, workdir), _artifact(labels_path, workdir), _artifact(output, workdir)], SQUISH_IDENTITY)
    if rc != 0:
        return MethodResult(RunStatus.FAILED, summary, f"SQUISH exited {rc}", [_artifact(input_path, workdir), _artifact(labels_path, workdir), _artifact(output, workdir)], SQUISH_IDENTITY)
    return MethodResult(RunStatus.SUCCESS, summary, artifacts=[_artifact(input_path, workdir), _artifact(labels_path, workdir), _artifact(output, workdir)], algorithm_identity=SQUISH_IDENTITY)


def _subdue_graph(corpus: Corpus) -> tuple[list[dict[str, Any]], int, int]:
    """Encode every playlist occurrence separately; directed edges never cross a set."""
    graph: list[dict[str, Any]] = []
    vertex_count = 0
    edge_count = 0
    for record in corpus.sets:
        set_token = hashlib.sha256(record.id.encode("utf-8")).hexdigest()[:16]
        vertices: list[str] = []
        for ordinal, track in enumerate(record.tracks, start=1):
            vertex_id = f"v_{set_token}_{ordinal}"
            vertices.append(vertex_id)
            graph.append({"vertex": {"id": vertex_id,
                                     "attributes": {"track": _token(track)},
                                     "timestamp": str(ordinal)}})
            vertex_count += 1
        for ordinal, (left, right) in enumerate(zip(vertices, vertices[1:]), start=1):
            graph.append({"edge": {"id": f"e_{set_token}_{ordinal}", "source": left, "target": right,
                                   "directed": "true", "attributes": {"relation": "follows"},
                                   "timestamp": str(ordinal)}})
            edge_count += 1
    return graph, vertex_count, edge_count


def run_subdue(corpus: Corpus, config: Mapping[str, Any]) -> MethodResult:
    """Run Holder's original SUBDUE process over opaque track-transition graphs."""
    graph, vertex_count, edge_count = _subdue_graph(corpus)
    if not edge_count:
        return MethodResult(RunStatus.NO_DATA, {"set_count": len(corpus.sets), "vertex_count": vertex_count,
                                                "edge_count": edge_count}, algorithm_identity=SUBDUE_IDENTITY)
    workdir = _workdir(config, "subdue")
    source = Path(str(config.get("subdue_root", os.environ.get("JUKEBOX_SUBDUE_ROOT", _default_upstream("subdue"))))).resolve()
    entrypoint = source / "src" / "Subdue.py"
    if not entrypoint.is_file():
        return MethodResult(RunStatus.UNSUPPORTED,
                            error=f"SUBDUE source is unavailable at {source}; expected holderlb/Subdue@{SUBDUE_COMMIT}",
                            algorithm_identity=SUBDUE_IDENTITY)
    pin_error = _validate_subdue_source(source)
    if pin_error:
        return MethodResult(RunStatus.UNSUPPORTED, error=pin_error, algorithm_identity=SUBDUE_IDENTITY)
    input_path = workdir / "input.json"
    import json
    input_path.write_text(json.dumps(graph, separators=(",", ":")), encoding="utf-8")
    output = workdir / "output.txt"
    def integer(name: str, default: int, minimum: int = 1) -> int:
        try:
            return max(minimum, int(config.get(name, default)))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{name} must be an integer") from exc
    effective = {"beam": integer("beam", 4), "limit": integer("limit", min(edge_count // 2, 200)),
                 "maxsize": integer("maxsize", 4), "minsize": integer("minsize", 2),
                 "numbest": integer("numbest", 3), "overlap": str(config.get("overlap", "none")),
                 "temporal": bool(config.get("temporal", False))}
    command = [sys.executable, str(entrypoint), "--beam", str(effective["beam"]), "--limit", str(effective["limit"]),
               "--maxsize", str(effective["maxsize"]), "--minsize", str(effective["minsize"]), "--numbest", str(effective["numbest"]),
               "--overlap", effective["overlap"], "--writepattern", "--writeinstances"]
    if effective["temporal"]:
        command.append("--temporal")
    command.append(str(input_path))
    rc, timed_out = _run(command, cwd=workdir, timeout=_timeout(config), output=output)
    pattern = workdir / "input-pattern-1.json"
    instances = workdir / "input-instances-1.json"
    artifacts = [_artifact(input_path, workdir), _artifact(output, workdir), *[_artifact(path, workdir) for path in (pattern, instances) if path.is_file()]]
    match = re.search(r"Best (\d+) patterns:", output.read_text(encoding="utf-8", errors="replace"))
    summary = {"set_count": len(corpus.sets), "vertex_count": vertex_count, "edge_count": edge_count,
               "graph_semantics": "set-local occurrence vertices with exact hashed track labels; directed follows edges stay within a set",
               "effective_parameters": effective,
               "reported_pattern_count": int(match.group(1)) if match else 0, "output_sha256": _digest(output)}
    if timed_out:
        return MethodResult(RunStatus.TIMED_OUT, summary, "SUBDUE execution timed out", artifacts, SUBDUE_IDENTITY)
    if rc != 0:
        return MethodResult(RunStatus.FAILED, summary, f"SUBDUE exited {rc}", artifacts, SUBDUE_IDENTITY)
    return MethodResult(RunStatus.SUCCESS, summary, artifacts=artifacts, algorithm_identity=SUBDUE_IDENTITY)


def register(registry: Any) -> None:
    registry.register(MethodAdapter("squish-original", SQUISH_IDENTITY, run_squish,
                                    "Authors' rich-interleaving SQUISH C++ release via local path/CLI bridge."))
    registry.register(MethodAdapter("subdue-original", SUBDUE_IDENTITY, run_subdue,
                                    "Holder's SUBDUE graph miner over opaque ordered track transitions."))
