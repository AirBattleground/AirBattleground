"""Layout configuration: config/layout.yaml deep-merged with the active model bundle's `layout` overrides."""

from __future__ import annotations

import copy
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

DEFAULT_LAYOUT_PATH = Path(__file__).resolve().parent / "layout.yaml"


def deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """Recursively merge `override` into a copy of `base` (dicts merge, everything else replaces)."""
    out = copy.deepcopy(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


@lru_cache(maxsize=4)
def _read_yaml(path: str, mtime: float) -> dict[str, Any]:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ValueError(f"layout file {path} must contain a mapping")
    return data


@lru_cache(maxsize=16)
def _merged(path: str, mtime: float, override_json: str) -> dict[str, Any]:
    return deep_merge(_read_yaml(path, mtime), json.loads(override_json))


def load_layout(path: Path | None = None, overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return the effective layout. Cached per (file mtime, overrides); callers must not mutate it."""
    p = (path or DEFAULT_LAYOUT_PATH).resolve()
    key = json.dumps(overrides or {}, sort_keys=True, default=str)
    return _merged(str(p), p.stat().st_mtime, key)
