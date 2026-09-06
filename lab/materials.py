"""Compact, local material store for LAB provenance edges."""
from __future__ import annotations

import hashlib
import inspect
import json
from pathlib import Path
from typing import Any, Callable

class MaterialStore:
    """Writes only compact JSON materials below an ignored LAB output directory."""
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def put(self, name: str, value: Any) -> dict[str, str]:
        if not name or any(char not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for char in name):
            raise ValueError(f"invalid material name: {name!r}")
        encoded = json.dumps(value, indent=2, sort_keys=True).encode("utf-8") + b"\n"
        path = self.root / f"{name}.json"
        path.write_bytes(encoded)
        return {"material": name, "path": str(path), "sha256": hashlib.sha256(encoded).hexdigest()}

def source_binding(callback: Callable[..., Any]) -> dict[str, str | None]:
    """Describe the exact local adapter implementation consumed by a Tick."""
    source = inspect.getsourcefile(callback)
    if source is None:
        return {"module": getattr(callback, "__module__", None), "source_sha256": None}
    path = Path(source)
    return {"module": getattr(callback, "__module__", None), "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
