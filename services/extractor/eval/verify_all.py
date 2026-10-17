"""Run the ACTIVE model (same registry as the live service) on every labelled screenshot and compare
with the hand labels. Writes eval/verify/predictions.json + mismatches.json and prints a per-image table.

Usage: uv run python -m eval.verify_all [--roster]   (roster = that match's SLOT_LIST labels, like a confirmed lineup)
"""

from __future__ import annotations

import json
import sys
import unicodedata
from pathlib import Path

from app.bundle import set_registry
from app.pipeline.orchestrator import extract_image
from app.schemas import Roster, RosterSlot
from app.training.registry import FileRegistry

ROOT = Path(__file__).resolve().parent
DS = ROOT / "dataset"
OUT = ROOT / "verify"


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s).strip()


def load() -> list[tuple[str, Path, dict, dict]]:
    out = []
    for lf in sorted(DS.glob("testingss/g*/labels.json")) + [DS / "real/labels.json"]:
        doc = json.loads(lf.read_text(encoding="utf-8"))
        group = "real" if lf.parent.name == "real" else lf.parent.name
        rosters: dict[str, dict[int, list[str]]] = {}
        for im in doc["images"]:
            if im["kind"] == "SLOT_LIST":
                r = rosters.setdefault(im.get("match", ""), {})
                for t in im["teams"]:
                    r.setdefault(t["slot"], [])
                    r[t["slot"]] += [p for p in t["players"] if p not in r[t["slot"]]]
        for im in doc["images"]:
            if im["kind"] != "OTHER":
                out.append((group, lf.parent / im["file"], im, rosters.get(im.get("match", ""), {})))
    return out


def main() -> None:
    use_roster = "--roster" in sys.argv
    reg = FileRegistry()
    set_registry(reg)
    version = reg.active_version()
    OUT.mkdir(exist_ok=True)
    preds, mism, rows_out = [], [], []
    tot = {"slot": [0, 0], "rank": [0, 0], "kills": [0, 0], "name": [0, 0]}
    for group, path, lab, roster in load():
        kind = "slot_list" if lab["kind"] == "SLOT_LIST" else "results"
        rs = Roster(slots=[RosterSlot(slot=s, players=p) for s, p in roster.items()]) if use_roster and roster else None
        ex = extract_image(path.read_bytes(), kind, rs, image_id=f"{group}/{path.name}")
        preds.append({"image": f"{group}/{path.name}", "extraction": ex.model_dump()})
        c = {"slot": [0, 0], "rank": [0, 0], "kills": [0, 0], "name": [0, 0]}
        miss = []

        def name_of(p) -> str:
            return p.roster_match or p.name

        if kind == "slot_list":
            got = {t.slot: t for t in ex.teams}
            for t in lab["teams"]:
                c["slot"][1] += 1
                g = got.get(t["slot"])
                if g is None:
                    miss.append({"what": "slot missing", "expected": t["slot"]})
                    c["name"][1] += len(t["players"])
                    continue
                c["slot"][0] += 1
                for i, exp in enumerate(t["players"]):
                    c["name"][1] += 1
                    pred = name_of(g.players[i]) if i < len(g.players) else None
                    conf = g.players[i].confidence if i < len(g.players) else None
                    if pred is not None and nfc(pred) == nfc(exp):
                        c["name"][0] += 1
                    else:
                        miss.append({"what": "name", "slot": t["slot"], "pos": i + 1, "expected": exp, "read": pred, "conf": conf})
            extra = sorted(set(got) - {t["slot"] for t in lab["teams"]})
            if extra:
                miss.append({"what": "extra slots read", "read": extra})
        else:
            got = {r.rank: r for r in ex.rows}
            for r in lab["rows"]:
                c["rank"][1] += 1
                g = got.get(r["rank"])
                if g is None:
                    miss.append({"what": "rank missing", "expected": r["rank"]})
                    c["name"][1] += len(r["players"])
                    c["kills"][1] += len(r["players"])
                    continue
                c["rank"][0] += 1
                for i, exp in enumerate(r["players"]):
                    c["name"][1] += 1
                    c["kills"][1] += 1
                    gp = g.players[i] if i < len(g.players) else None
                    if gp is not None and nfc(name_of(gp)) == nfc(exp["name"]):
                        c["name"][0] += 1
                    else:
                        miss.append({"what": "name", "rank": r["rank"], "pos": i + 1, "expected": exp["name"],
                                     "read": name_of(gp) if gp else None, "conf": gp.confidence if gp else None})
                    if gp is not None and gp.kills == exp["kills"]:
                        c["kills"][0] += 1
                    else:
                        miss.append({"what": "finishes", "rank": r["rank"], "pos": i + 1, "player": exp["name"],
                                     "expected": exp["kills"], "read": gp.kills if gp else None})
            extra = sorted(k for k in set(got) - {r["rank"] for r in lab["rows"]} if k is not None)
            if extra:
                miss.append({"what": "extra ranks read", "read": extra})
        for k in tot:
            tot[k][0] += c[k][0]
            tot[k][1] += c[k][1]
        mism.append({"image": f"{group}/{path.name}", "kind": lab["kind"], "counts": c, "misses": miss})
        rows_out.append((f"{group}/{path.name}", lab["kind"], c, len(miss)))
    (OUT / f"predictions{'_roster' if use_roster else ''}.json").write_text(json.dumps(preds, ensure_ascii=False, indent=1))
    (OUT / f"mismatches{'_roster' if use_roster else ''}.json").write_text(json.dumps(mism, ensure_ascii=False, indent=1))
    pct = lambda a: f"{a[0]}/{a[1]} ({100 * a[0] / a[1]:.1f}%)" if a[1] else "—"
    print(f"model {version} | roster={'on' if use_roster else 'off'} | {len(rows_out)} images")
    for k, v in tot.items():
        print(f"  {k:<6} {pct(v)}")
    perfect = sum(1 for *_, n in rows_out if n == 0)
    print(f"  images read perfectly: {perfect}/{len(rows_out)}")


if __name__ == "__main__":
    main()
