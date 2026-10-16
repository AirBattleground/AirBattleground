"""Filesystem locations for the training system (env-configurable) and safe path handling."""

from __future__ import annotations

import contextlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any

SERVICE_DIR = Path(__file__).resolve().parents[2]  # services/extractor
# <repo>/services/extractor in the monorepo; in a container the code may live at /app (no grandparent),
# so fall back to the service dir itself (MODELS_DIR / STORAGE_DIR env or settings normally win anyway).
REPO_DIR = SERVICE_DIR.parents[1] if len(SERVICE_DIR.parents) >= 2 else SERVICE_DIR


def _settings_path(attr: str, default: Path) -> Path:
    try:  # app.settings (pipeline-owned) also reads services/extractor/.env
        from app.settings import get_settings

        return Path(getattr(get_settings(), attr))
    except Exception:
        return default


def models_dir() -> Path:
    env = os.environ.get("MODELS_DIR")
    return Path(env).resolve() if env else _settings_path("models_dir", SERVICE_DIR / "models").resolve()


def storage_dir() -> Path:
    env = os.environ.get("STORAGE_DIR")
    return Path(env).resolve() if env else _settings_path("storage_dir", REPO_DIR / "storage").resolve()


class UnsafePathError(ValueError):
    pass


def resolve_inside(root: Path, relative: str) -> Path:
    """Resolve `relative` under `root`; reject absolute paths, `..` escapes and symlink escapes."""
    if not relative or "\x00" in relative:
        raise UnsafePathError("empty or invalid image path")
    if Path(relative).is_absolute():
        raise UnsafePathError(f"image path must be relative to STORAGE_DIR: {relative}")
    root = root.resolve()
    p = (root / relative).resolve()
    if p != root and root not in p.parents:
        raise UnsafePathError(f"image path escapes STORAGE_DIR: {relative}")
    return p


def atomic_write_text(path: Path, text: str) -> None:
    """Write via a temp file in the same dir + fsync + os.replace (readers never see a partial file)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(tmp)
        raise


def atomic_write_json(path: Path, data: Any) -> None:
    atomic_write_text(path, json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False) + "\n")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))
