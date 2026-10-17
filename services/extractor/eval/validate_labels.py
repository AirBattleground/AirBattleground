"""Validate a labels.json (same format as eval/dataset/real/labels.json) and cross-check consistency.

Usage: uv run python -m eval.validate_labels eval/dataset/testingss/g10/labels.json [...]
Checks: schema; slot/rank ranges; 1-6 players; kills 0-99; no duplicate slots per image; RESULTS ranks
consistent across screenshots of the group (same rank → same players & kills); every RESULTS row's players
map to exactly one lobby slot when the group has SLOT_LIST labels (reports rows that don't).
"""

from __future__ import annotations

import json
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path


def norm(s: str) -> str:
    return unicodedata.normalize("NFC", s).strip()


def check(path: Path) -> list[str]:
    errs: list[str] = []
    doc = json.loads(path.read_text(encoding="utf-8"))
    imgs = doc.get("images", [])
    if not imgs:
        return [f"{path}: no images"]
    base = path.parent
    slot_of: dict[str, set[int]] = defaultdict(set)
    rank_seen: dict[int, tuple] = {}
    for im in imgs:
        f, kind = im.get("file"), im.get("kind")
        where = f"{path.parent.name}/{f}"
        if not f or not (base / f).exists():
            errs.append(f"{where}: file missing")
        if kind == "SLOT_LIST":
            slots = [t["slot"] for t in im.get("teams", [])]
            if len(slots) != len(set(slots)):
                errs.append(f"{where}: duplicate slots {slots}")
            for t in im.get("teams", []):
                if not (1 <= t["slot"] <= 100) or not (1 <= len(t["players"]) <= 6):
                    errs.append(f"{where}: bad team {t}")
                for p in t["players"]:
                    if not norm(p):
                        errs.append(f"{where}: empty name in slot {t['slot']}")
                    slot_of[norm(p)].add(t["slot"])
        elif kind == "RESULTS":
            for r in im.get("rows", []):
                key = tuple((norm(p["name"]), p["kills"]) for p in r["players"])
                if not (1 <= r["rank"] <= 100) or not (1 <= len(r["players"]) <= 6):
                    errs.append(f"{where}: bad row {r}")
                for p in r["players"]:
                    if not (0 <= p["kills"] <= 99) or not norm(p["name"]):
                        errs.append(f"{where}: bad player {p}")
                prev = rank_seen.get(r["rank"])
                if prev is not None and sorted(prev) != sorted(key):
                    errs.append(f"{where}: rank {r['rank']} differs from another screenshot: {prev} vs {key}")
                rank_seen[r["rank"]] = key
        elif kind != "OTHER":
            errs.append(f"{where}: unknown kind {kind!r}")
    if slot_of:
        for rank, key in sorted(rank_seen.items()):
            slots = {s for name, _ in key for s in slot_of.get(name, set())}
            missing = [name for name, _ in key if name not in slot_of]
            if len(slots) > 1:
                errs.append(f"rank {rank}: players map to several lobby slots {sorted(slots)}")
            if missing and len(missing) < len(key):
                errs.append(f"rank {rank}: names not in any lobby screenshot (typo?): {missing}")
    return errs


if __name__ == "__main__":
    total = 0
    for a in sys.argv[1:]:
        e = check(Path(a))
        total += len(e)
        print(f"{a}: {'OK' if not e else f'{len(e)} problem(s)'}")
        for x in e:
            print("   -", x)
    sys.exit(1 if total else 0)
