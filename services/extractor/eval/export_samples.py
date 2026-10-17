"""Export labelled screenshots as one JSON per image for import into the 7xen training center.

Usage: uv run python -m eval.export_samples OUT_DIR [--test-groups g03,g06,...]
Writes OUT_DIR/index.json: [{path, kind, split, labels, notes}] (OTHER images skipped). Splits by whole
match group so screenshots of the same match never land in both TRAIN and TEST.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "dataset"


def main() -> None:
    out = Path(sys.argv[1])
    test_groups = {"g03", "g06", "g12", "g16", "g19"}
    if "--test-groups" in sys.argv:
        test_groups = set(sys.argv[sys.argv.index("--test-groups") + 1].split(","))
    items = []
    for lf in sorted(ROOT.glob("testingss/g*/labels.json")) + [ROOT / "real/labels.json"]:
        doc = json.loads(lf.read_text(encoding="utf-8"))
        group = lf.parent.name
        check = set(doc.get("needs_human_check", []))
        for im in doc["images"]:
            if im["kind"] == "OTHER":
                continue
            labels = {"teams": im["teams"]} if im["kind"] == "SLOT_LIST" else {"rows": im["rows"]}
            names = [p for t in im.get("teams", []) for p in t["players"]] + [
                p["name"] for r in im.get("rows", []) for p in r["players"]
            ]
            unsure = sorted({n for n in names if n in check})
            note = f"Labelled by Claude from the image ({group}/{im['file']}), cross-checked against other screenshots."
            if unsure:
                note += " Please confirm: " + ", ".join(unsure)
            items.append(
                {
                    "path": str((lf.parent / im["file"]).resolve()),
                    "kind": im["kind"],
                    "split": "TEST" if group in test_groups else "TRAIN",
                    "labels": labels,
                    "notes": note[:500],
                }
            )
    out.mkdir(parents=True, exist_ok=True)
    (out / "index.json").write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(items)} samples → {out/'index.json'}  (TEST groups: {sorted(test_groups)})")


if __name__ == "__main__":
    main()
