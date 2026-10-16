"""On-disk model registry (implements app.bundle.Registry).

Layout of MODELS_DIR:
    active.json                {"version": "v1", "previous": "v0", "activated_at": "..."}
    v0/manifest.json           stock PaddleOCR ("base"), no artifacts
    v1/manifest.json           {version, parent, status, trainer, created_at, sample_count, metrics, notes,
                                artifacts: {...}}
    v1/lexicon.json            ["name", ...]           (optional)
    v1/char_fixes.json         {...}                   (optional)
    v1/layout.json             {...}                   (optional)
    v1/rec_model/              PaddleOCR inference model (optional; + rec_model/train/ checkpoint)
    runs/<run-id>.json         training run records (app.training.runs)

Every JSON write is atomic (tmp + fsync + rename). A version dir is reserved with an exclusive mkdir, so two
trainers can never get the same version number. A version is only activatable once its manifest says
status=ready; activating writes active.json atomically, so a crash leaves the previous pointer intact.
Rollback = activate an older version.
"""

from __future__ import annotations

import contextlib
import contextvars
import re
import shutil
import threading
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.bundle import ModelBundle
from app.schemas import EvalMetrics, ModelList, ModelVersionInfo
from app.training.paths import atomic_write_json, models_dir, read_json

BASE_VERSION = "v0"
_VERSION_RE = re.compile(r"^v(\d+)$")
ARTIFACT_FILES = {"lexicon": "lexicon.json", "char_fixes": "char_fixes.json", "layout": "layout.json"}
REC_MODEL_DIR = "rec_model"

# Per-context bundle override: lets evaluation/training run the pipeline with a candidate or non-active
# bundle without touching what concurrent /v1/extract requests see.
_override: contextvars.ContextVar[ModelBundle | None] = contextvars.ContextVar(
    "bundle_override", default=None
)


class RegistryError(Exception):
    pass


class VersionNotFound(RegistryError):
    pass


class VersionNotReady(RegistryError):
    pass


def now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def version_number(version: str) -> int:
    m = _VERSION_RE.match(version)
    if not m:
        raise VersionNotFound(f"invalid model version: {version!r}")
    return int(m.group(1))


@dataclass
class VersionDraft:
    """A reserved, not-yet-ready version. Trainers write artifacts into `path`."""

    version: str
    parent: str
    path: Path
    trainer: str

    def write_lexicon(self, names: list[str]) -> None:
        atomic_write_json(self.path / ARTIFACT_FILES["lexicon"], sorted(set(names)))

    def write_char_fixes(self, fixes: dict[str, Any]) -> None:
        atomic_write_json(self.path / ARTIFACT_FILES["char_fixes"], fixes)

    def write_layout(self, layout: dict[str, Any]) -> None:
        atomic_write_json(self.path / ARTIFACT_FILES["layout"], layout)

    @property
    def rec_model_dir(self) -> Path:
        return self.path / REC_MODEL_DIR


class FileRegistry:
    def __init__(self, root: Path | None = None) -> None:
        self.root = (root or models_dir()).resolve()
        self._lock = threading.RLock()
        self._active_key: tuple[int, int, int] | None = None
        self._active_ver: str | None = None
        self._bundles: dict[str, tuple[float, ModelBundle]] = {}
        self.ensure_base()

    # ---------------- setup ----------------
    def ensure_base(self) -> None:
        with self._lock:
            self.root.mkdir(parents=True, exist_ok=True)
            base = self.root / BASE_VERSION
            if not (base / "manifest.json").exists():
                base.mkdir(exist_ok=True)
                atomic_write_json(
                    base / "manifest.json",
                    {
                        "version": BASE_VERSION,
                        "parent": None,
                        "status": "ready",
                        "trainer": "stock",
                        "created_at": now_iso(),
                        "sample_count": 0,
                        "metrics": None,
                        "notes": 'Stock PaddleOCR recognition model, no learned artifacts ("base").',
                        "artifacts": {},
                    },
                )
            if not self._active_file.exists():
                atomic_write_json(
                    self._active_file, {"version": BASE_VERSION, "previous": None, "activated_at": now_iso()}
                )

    @property
    def _active_file(self) -> Path:
        return self.root / "active.json"

    # ---------------- bundle.Registry ----------------
    def active(self) -> ModelBundle:
        ov = _override.get()
        if ov is not None:
            return ov
        return self.get(self.active_version())

    def get(self, version: str) -> ModelBundle:
        if version == "base":
            version = BASE_VERSION
        d = self._version_dir(version)
        mf = d / "manifest.json"
        try:
            mtime = mf.stat().st_mtime
        except FileNotFoundError:
            raise VersionNotFound(f"model version {version} does not exist") from None
        with self._lock:
            cached = self._bundles.get(version)
            if cached and cached[0] == mtime:
                return cached[1]
            bundle = self._load_bundle(version, d)
            self._bundles[version] = (mtime, bundle)
            return bundle

    def active_version(self) -> str:
        """Current pointer; cached on (inode, mtime, size) of active.json so per-request cost is one stat."""
        try:
            st = self._active_file.stat()
            key = (st.st_ino, st.st_mtime_ns, st.st_size)
        except FileNotFoundError:
            return BASE_VERSION
        with self._lock:
            if key != self._active_key or self._active_ver is None:
                try:
                    v = str(read_json(self._active_file)["version"])
                    self.manifest(v)  # must exist
                except Exception:
                    v = BASE_VERSION  # corrupt/missing pointer -> stock model, never crash extraction
                self._active_key = key
                self._active_ver = v
            return self._active_ver

    # ---------------- overrides (eval / training) ----------------
    @contextlib.contextmanager
    def override(self, bundle: ModelBundle) -> Iterator[ModelBundle]:
        token = _override.set(bundle)
        try:
            yield bundle
        finally:
            _override.reset(token)

    # ---------------- reading ----------------
    def _version_dir(self, version: str) -> Path:
        version_number(version)  # validates the name (no path tricks)
        return self.root / version

    def manifest(self, version: str) -> dict[str, Any]:
        mf = self._version_dir(version) / "manifest.json"
        if not mf.exists():
            raise VersionNotFound(f"model version {version} does not exist")
        data: dict[str, Any] = read_json(mf)
        return data

    def versions(self) -> list[str]:
        out = [
            p.name
            for p in self.root.iterdir()
            if _VERSION_RE.match(p.name) and (p / "manifest.json").exists()
        ]
        return sorted(out, key=version_number)

    def _load_bundle(self, version: str, d: Path) -> ModelBundle:
        m = self.manifest(version)
        if m.get("status") != "ready":
            raise VersionNotReady(f"model version {version} is {m.get('status')}, not ready")
        lexicon: tuple[str, ...] = ()
        char_fixes: dict[str, Any] = {}
        layout: dict[str, Any] = {}
        if (d / ARTIFACT_FILES["lexicon"]).exists():
            lexicon = tuple(read_json(d / ARTIFACT_FILES["lexicon"]))
        if (d / ARTIFACT_FILES["char_fixes"]).exists():
            char_fixes = read_json(d / ARTIFACT_FILES["char_fixes"])
        if (d / ARTIFACT_FILES["layout"]).exists():
            layout = read_json(d / ARTIFACT_FILES["layout"])
        rec = d / REC_MODEL_DIR
        rec_dir = rec if (rec / "inference.yml").exists() or any(rec.glob("inference.*")) else None
        return ModelBundle(
            version=version,
            path=d,
            rec_model_dir=rec_dir,
            lexicon=lexicon,
            char_fixes=char_fixes,
            layout=layout,
        )

    def info(self, version: str, active: str | None = None) -> ModelVersionInfo:
        m = self.manifest(version)
        metrics = m.get("metrics")
        return ModelVersionInfo(
            version=m["version"],
            parent=m.get("parent"),
            status=m.get("status", "failed"),
            active=(version == (active or self.active_version())),
            trainer=m.get("trainer", "unknown"),
            created_at=m.get("created_at", ""),
            sample_count=int(m.get("sample_count") or 0),
            metrics=EvalMetrics.model_validate(metrics) if metrics else None,
            notes=m.get("notes"),
        )

    def list_models(self) -> ModelList:
        active = self.active_version()
        items = []
        for v in reversed(self.versions()):
            try:
                items.append(self.info(v, active))
            except Exception:  # unreadable manifest: skip rather than break the listing
                continue
        return ModelList(active=active, items=items)

    # ---------------- writing ----------------
    def create_version(
        self, parent: str, trainer: str, notes: str | None = None, sample_count: int = 0
    ) -> VersionDraft:
        """Reserve the next version number (exclusive mkdir) with status=training."""
        if self.manifest(parent).get("status") != "ready":
            raise VersionNotReady(f"base version {parent} is not ready")
        with self._lock:
            n = max((version_number(v) for v in self._all_version_dirs()), default=0) + 1
            while True:
                d = self.root / f"v{n}"
                try:
                    d.mkdir()
                    break
                except FileExistsError:
                    n += 1
            version = f"v{n}"
            atomic_write_json(
                d / "manifest.json",
                {
                    "version": version,
                    "parent": parent,
                    "status": "training",
                    "trainer": trainer,
                    "created_at": now_iso(),
                    "sample_count": sample_count,
                    "metrics": None,
                    "notes": notes,
                    "artifacts": {},
                },
            )
        return VersionDraft(version=version, parent=parent, path=d, trainer=trainer)

    def _all_version_dirs(self) -> list[str]:
        return [p.name for p in self.root.iterdir() if _VERSION_RE.match(p.name)]

    def update_manifest(self, version: str, **fields: Any) -> dict[str, Any]:
        with self._lock:
            m = self.manifest(version)
            m.update(fields)
            atomic_write_json(self._version_dir(version) / "manifest.json", m)
            self._bundles.pop(version, None)
            return m

    def finalize(
        self,
        draft: VersionDraft,
        *,
        trainer: str,
        sample_count: int,
        metrics: EvalMetrics | None,
        notes: str | None,
        extra: dict[str, Any] | None = None,
    ) -> ModelVersionInfo:
        artifacts = {k: f for k, f in ARTIFACT_FILES.items() if (draft.path / f).exists()}
        if (draft.rec_model_dir / "inference.yml").exists() or any(draft.rec_model_dir.glob("inference.*")):
            artifacts["rec_model_dir"] = REC_MODEL_DIR
        self.update_manifest(
            draft.version,
            status="ready",
            trainer=trainer,
            sample_count=sample_count,
            metrics=metrics.model_dump() if metrics else None,
            notes=notes,
            artifacts=artifacts,
            finished_at=now_iso(),
            **(extra or {}),
        )
        return self.info(draft.version)

    def mark_failed(self, version: str, error: str) -> None:
        with contextlib.suppress(VersionNotFound):
            self.update_manifest(
                version, status="failed", notes=f"failed: {error}"[:2000], finished_at=now_iso()
            )

    def activate(self, version: str) -> ModelList:
        if version == "base":
            version = BASE_VERSION
        m = self.manifest(version)
        if m.get("status") != "ready":
            raise VersionNotReady(f"model version {version} is {m.get('status')} and cannot be activated")
        self.get(version)  # artifacts must load before we point at them
        with self._lock:
            previous = self.active_version()
            atomic_write_json(
                self._active_file, {"version": version, "previous": previous, "activated_at": now_iso()}
            )
            self._active_key = None
        return self.list_models()

    def delete_failed(self, version: str) -> None:
        """Remove a failed version dir (never the active one or a ready one)."""
        m = self.manifest(version)
        if m.get("status") != "failed" or version == self.active_version():
            raise RegistryError("only failed, inactive versions can be deleted")
        shutil.rmtree(self._version_dir(version))


_default: FileRegistry | None = None
_default_lock = threading.Lock()


def get_registry() -> FileRegistry:
    """Process-wide registry for MODELS_DIR (re-created if MODELS_DIR changes, e.g. in tests)."""
    global _default
    with _default_lock:
        if _default is None or _default.root != models_dir():
            _default = FileRegistry()
        return _default
