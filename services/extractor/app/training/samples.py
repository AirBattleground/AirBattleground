"""Labelled samples: loading (API SampleRef or eval labels.json), stable TRAIN/TEST split, rosters."""

from __future__ import annotations

import hashlib
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from app.schemas import Kind, Roster, RosterSlot, SampleRef
from app.training.paths import read_json, resolve_inside, storage_dir

Split = Literal["train", "test"]
TRAIN_FRACTION = 0.70

_KIND_ALIASES: dict[str, Kind] = {
    "slot_list": "slot_list",
    "SLOT_LIST": "slot_list",
    "results": "results",
    "RESULTS": "results",
}


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s).strip()


def stable_split(key: str | bytes, train_fraction: float = TRAIN_FRACTION) -> Split:
    """Deterministic 70/30 split by sha256 (of the image bytes, per the architecture doc)."""
    data = key.encode() if isinstance(key, str) else key
    h = int.from_bytes(hashlib.sha256(data).digest()[:8], "big")
    return "train" if (h % 10_000) < int(train_fraction * 10_000) else "test"


@dataclass
class Sample:
    id: str
    kind: Kind
    image_path: Path
    labels: dict[str, Any]
    split: Split
    synthetic: bool = False
    needs_human_check: frozenset[str] = field(default_factory=frozenset)

    def image_bytes(self) -> bytes:
        return self.image_path.read_bytes()

    def label_names(self) -> list[str]:
        return label_names(self.kind, self.labels)


def label_names(kind: Kind, labels: dict[str, Any]) -> list[str]:
    out: list[str] = []
    if kind == "slot_list":
        for t in labels.get("teams", []):
            out.extend(nfc(str(p)) for p in t.get("players", []))
    else:
        for r in labels.get("rows", []):
            for p in r.get("players", []):
                out.append(nfc(str(p["name"] if isinstance(p, dict) else p)))
    return out


def from_refs(refs: list[SampleRef], root: Path | None = None) -> list[Sample]:
    """API samples; image paths are relative to STORAGE_DIR and must stay inside it."""
    base = root or storage_dir()
    out = []
    for r in refs:
        p = resolve_inside(base, r.image_path)
        if not p.is_file():
            raise FileNotFoundError(f"sample {r.id}: image not found: {r.image_path}")
        out.append(Sample(id=r.id, kind=r.kind, image_path=p, labels=r.labels, split=r.split))
    return out


def load_dataset(dataset_dir: Path, *, synthetic: bool | None = None) -> list[Sample]:
    """Load an eval dataset dir (labels.json in the eval/dataset/real format + images next to it)."""
    data = read_json(dataset_dir / "labels.json")
    flagged = frozenset(nfc(n) for n in data.get("needs_human_check", []))
    is_synth = bool(data.get("synthetic", False)) if synthetic is None else synthetic
    out = []
    for img in data["images"]:
        kind = _KIND_ALIASES[img["kind"]]
        path = dataset_dir / img["file"]
        labels = {"teams": img["teams"]} if kind == "slot_list" else {"rows": img["rows"]}
        split: Split = img.get("split") or stable_split(path.read_bytes())
        out.append(
            Sample(
                id=Path(img["file"]).stem,
                kind=kind,
                image_path=path,
                labels=labels,
                split=split,
                synthetic=is_synth,
                needs_human_check=flagged,
            )
        )
    return out


def roster_from_samples(samples: list[Sample]) -> Roster:
    """The confirmed lineup implied by SLOT_LIST labels (what apps/api sends as `roster`)."""
    slots: dict[int, list[str]] = {}
    for s in samples:
        if s.kind != "slot_list":
            continue
        for t in s.labels.get("teams", []):
            names = slots.setdefault(int(t["slot"]), [])
            for p in t.get("players", []):
                if nfc(p) not in names:
                    names.append(nfc(p))
    return Roster(slots=[RosterSlot(slot=k, players=v) for k, v in sorted(slots.items())])


def split_samples(samples: list[Sample]) -> tuple[list[Sample], list[Sample]]:
    return [s for s in samples if s.split == "train"], [s for s in samples if s.split == "test"]
