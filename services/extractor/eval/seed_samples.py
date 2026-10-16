"""Seed the 7 real screenshots as training samples.

Copies eval/dataset/real/*.jpg → STORAGE_DIR/samples/seed/ and writes SampleRef JSON (app/schemas.py) to
eval/dataset/real/samples.export.json for apps/api to import as TrainingSample(source=SEED, verified=false).
Split = stable 70/30 by sha256 of the image bytes (same rule the API uses).

    uv run python -m eval.seed_samples [--storage-dir DIR] [--print]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parents[1]
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

from app.schemas import SampleRef  # noqa: E402
from app.training.paths import storage_dir  # noqa: E402
from app.training.samples import load_dataset  # noqa: E402

REAL_DIR = SERVICE_DIR / "eval" / "dataset" / "real"
EXPORT = REAL_DIR / "samples.export.json"


def seed(storage: Path, real_dir: Path = REAL_DIR) -> list[dict[str, object]]:
    dest = storage / "samples" / "seed"
    dest.mkdir(parents=True, exist_ok=True)
    flagged = json.loads((real_dir / "labels.json").read_text(encoding="utf-8")).get("needs_human_check", [])
    out = []
    for s in load_dataset(real_dir):
        shutil.copy2(s.image_path, dest / s.image_path.name)
        ref = SampleRef(
            id=f"seed-{s.id}",
            kind=s.kind,
            image_path=f"samples/seed/{s.image_path.name}",
            labels=s.labels,
            split=s.split,
        )
        names = set(s.label_names())
        out.append(
            {
                **ref.model_dump(),
                "sha256": hashlib.sha256(s.image_bytes()).hexdigest(),
                "source": "SEED",
                "verified": False,
                "needs_human_check": sorted(n for n in flagged if n in names),
            }
        )
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--storage-dir", type=Path, default=None)
    ap.add_argument("--print", action="store_true", help="also print the export JSON")
    a = ap.parse_args(argv)
    storage = (a.storage_dir or storage_dir()).resolve()
    refs = seed(storage)
    payload = {
        "_about": "SampleRef export of the 7 real seed screenshots (image_path relative to STORAGE_DIR). "
        "Import as "
        "TrainingSample(source=SEED, verified=false); `needs_human_check` lists ambiguous names to confirm.",
        "samples": refs,
    }
    EXPORT.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    if a.print:
        print(json.dumps(payload, ensure_ascii=False, indent=1))
    splits = {r["id"]: r["split"] for r in refs}
    print(
        f"copied {len(refs)} screenshots to {storage / 'samples' / 'seed'}; wrote {EXPORT}; splits={splits}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
