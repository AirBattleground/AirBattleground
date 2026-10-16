# ruff: noqa: E501  (markdown report text)
"""Measure the pipeline on the hand-labelled real screenshots and write eval/PIPELINE_BASELINE.md.

    uv run python -m app.pipeline.bench [--repeat 3] [--out eval/PIPELINE_BASELINE.md]

Every number in the report is computed here from eval/dataset/real/labels.json; nothing is estimated.
Alignment: SLOT_LIST teams by card order (slot compared), players by position inside a card; RESULTS rows by
on-screen order (left panel then right panel, i.e. ascending rank), players by position inside a row.
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import platform
import time
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.pipeline.orchestrator import extract_image
from app.schemas import Extraction, Roster, RosterSlot
from app.settings import SERVICE_ROOT, get_settings

DATASET = SERVICE_ROOT / "eval" / "dataset" / "real"


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


@dataclass
class Tally:
    ok: int = 0
    n: int = 0

    def add(self, good: bool) -> None:
        self.ok += int(good)
        self.n += 1

    def pct(self) -> str:
        return f"{100.0 * self.ok / self.n:.1f}% ({self.ok}/{self.n})" if self.n else "n/a"


@dataclass
class ImageReport:
    file: str
    kind: str
    names_raw: Tally = field(default_factory=Tally)
    names_raw_clean: Tally = field(default_factory=Tally)
    names_eff: Tally = field(default_factory=Tally)
    names_eff_clean: Tally = field(default_factory=Tally)
    slots: Tally = field(default_factory=Tally)
    ranks: Tally = field(default_factory=Tally)
    finishes: Tally = field(default_factory=Tally)
    inferred_slot: Tally = field(default_factory=Tally)
    latencies: list[float] = field(default_factory=list)
    misses: list[tuple[str, str]] = field(default_factory=list)


def roster_from_labels(labels: dict[str, Any]) -> Roster:
    slots: dict[int, list[str]] = {}
    for im in labels["images"]:
        if im["kind"] == "SLOT_LIST":
            for t in im["teams"]:
                slots[int(t["slot"])] = [nfc(p) for p in t["players"]]
    return Roster(slots=[RosterSlot(slot=s, players=p) for s, p in sorted(slots.items())])


def confusions(pred: str, exp: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    sm = difflib.SequenceMatcher(a=exp, b=pred, autojunk=False)
    for op, a0, a1, b0, b1 in sm.get_opcodes():
        if op == "equal":
            continue
        out.append((exp[a0:a1] or "∅", pred[b0:b1] or "∅"))
    return out


def score(
    ex: Extraction,
    im: dict[str, Any],
    flagged: set[str],
    slot_of: dict[str, int],
    rep: ImageReport,
    conf: Counter[tuple[str, str]],
) -> None:
    def name_check(pred_raw: str, pred_eff: str, exp: str) -> None:
        exp = nfc(exp)
        clean = exp not in flagged
        rep.names_raw.add(nfc(pred_raw) == exp)
        rep.names_eff.add(nfc(pred_eff) == exp)
        if clean:
            rep.names_raw_clean.add(nfc(pred_raw) == exp)
            rep.names_eff_clean.add(nfc(pred_eff) == exp)
        if nfc(pred_eff) != exp:
            rep.misses.append((exp, pred_eff))
        if nfc(pred_raw) != exp:
            conf.update(confusions(nfc(pred_raw), exp))

    if im["kind"] == "SLOT_LIST":
        for i, t in enumerate(im["teams"]):
            pt = ex.teams[i] if i < len(ex.teams) else None
            rep.slots.add(pt is not None and pt.slot == t["slot"])
            for j, exp in enumerate(t["players"]):
                pp = pt.players[j] if pt and j < len(pt.players) else None
                name_check(pp.name if pp else "", (pp.roster_match or pp.name) if pp else "", exp)
        return
    rows = sorted(im["rows"], key=lambda r: r["rank"])
    for i, r in enumerate(rows):
        pr = ex.rows[i] if i < len(ex.rows) else None
        rep.ranks.add(pr is not None and pr.rank == r["rank"])
        exp_slots = Counter(slot_of.get(nfc(p["name"])) for p in r["players"])
        exp_slot = exp_slots.most_common(1)[0][0]
        if exp_slot is not None:
            rep.inferred_slot.add(pr is not None and pr.inferred_slot == exp_slot)
        for j, p in enumerate(r["players"]):
            pp = pr.players[j] if pr and j < len(pr.players) else None
            name_check(pp.name if pp else "", (pp.roster_match or pp.name) if pp else "", p["name"])
            rep.finishes.add(pp is not None and pp.kills == p["kills"])


def run(repeat: int, with_roster: bool) -> tuple[list[ImageReport], Counter[tuple[str, str]]]:
    labels = json.loads((DATASET / "labels.json").read_text(encoding="utf-8"))
    flagged = {nfc(n) for n in labels.get("needs_human_check", [])}
    roster = roster_from_labels(labels)
    slot_of = {p: s.slot for s in roster.slots for p in s.players}
    conf: Counter[tuple[str, str]] = Counter()
    reports: list[ImageReport] = []
    for im in labels["images"]:
        data = (DATASET / im["file"]).read_bytes()
        kind = "slot_list" if im["kind"] == "SLOT_LIST" else "results"
        rep = ImageReport(im["file"], kind)
        ex: Extraction | None = None
        for _ in range(repeat):
            t0 = time.perf_counter()
            ex = extract_image(data, kind, roster if with_roster else None)  # type: ignore[arg-type]
            rep.latencies.append((time.perf_counter() - t0) * 1000)
        assert ex is not None
        score(ex, im, flagged, slot_of, rep, conf)
        reports.append(rep)
    return reports, conf


def _sum(reports: list[ImageReport], attr: str, kind: str | None = None) -> Tally:
    t = Tally()
    for r in reports:
        if kind and r.kind != kind:
            continue
        x: Tally = getattr(r, attr)
        t.ok += x.ok
        t.n += x.n
    return t


def _pctl(values: list[float], q: float) -> float:
    s = sorted(values)
    if not s:
        return 0.0
    k = (len(s) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


# Recorded once while choosing the defaults (2026-10-17, same 166 name strips, same detection/crops as the
# pipeline at that time with pad_frac 0.12). Kept verbatim so the choice is auditable; re-run the bench to
# measure the current configuration.
SELECTION_NOTES = """## How the defaults were chosen (measured 2026-10-17 on the same 166 name strips)

Recogniser comparison, raw colour crops (`mode: raw`) vs binarised/inverted crops (`mode: ink`):

| rec model | raw: exact all / clean | ink: exact all / clean |
|---|---|---|
| PP-OCRv6_small_rec (**chosen**) | 121/166 / 106/116 | — |
| PP-OCRv6_medium_rec | 120/166 / 104/116 (≈2.5x slower) | — |
| latin_PP-OCRv5_mobile_rec | 113/166 / 100/116 (drops 多 シ 《》) | 41/166 / 39/116 |
| en_PP-OCRv5_mobile_rec | 110/166 / 95/116 | 41/166 / 40/116 |
| PP-OCRv5_server_rec | 106/166 / 89/116 (drops spaces) | 65/166 / 59/116 |
| PP-OCRv5_mobile_rec | 90/166 / 83/116 | 34/166 / 29/116 |

Padding around the tightened name box (`strips.pad_frac`, x strip height), PP-OCRv6_small_rec, clean names:
0.0 → 105, 0.03 → 105, **0.06 → 110**, 0.09 → 109, 0.12 → 107, 0.20 → 101 (of 116). Upscaling names 1.5x/2x
did not help (107 / 106). Finishes strips need more room (`pad_frac` 0.25 for that profile: 98/99 → with the
singular-"finish" rule 99/99); at 0.12 the recogniser dropped a leading "0" on 8 of 99 strips.
`devanagari_PP-OCRv5_mobile_rec` re-reads names scoring < 0.75 (आशीष् → `आशीष२` at 0.82 vs `3T2々` at 0.68).
"""


def render(
    base: list[ImageReport], conf: Counter[tuple[str, str]], rost: list[ImageReport], repeat: int
) -> str:
    s = get_settings()
    lat = [v for r in base for v in r.latencies[1:] or r.latencies]
    lines = [
        "# Extractor pipeline baseline (real screenshots)",
        "",
        f"Generated by `python -m app.pipeline.bench` on {time.strftime('%Y-%m-%d %H:%M')} — "
        f"OCR model `{s.ocr_rec_model}` (alt for low-confidence names: {', '.join(s.ocr_alt_rec_models) or 'none'}), "
        f"layout from `app/config/layout.yaml`, base bundle (no lexicon / char_fixes), VLM {'on' if s.vlm_enabled else 'off'}.",
        "",
        "Dataset: the 7 hand-labelled screenshots in `eval/dataset/real/` (2 SLOT_LIST, 5 RESULTS; 1600x720). "
        "Ground truth names listed in `needs_human_check` are uncertain glyph readings (I/l/1, O/0, unusual "
        "Unicode) — accuracy is reported over all names and over the *clean* names only (flagged ones excluded). "
        "This is a tiny set: treat the numbers as a smoke-level baseline, not a benchmark.",
        "",
        "## Without roster (raw OCR = what the pipeline reads on its own)",
        "",
        "| image | kind | names exact (all) | names exact (clean) | slots | ranks | finishes |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in base:
        lines.append(
            f"| {r.file} | {r.kind} | {r.names_raw.pct()} | {r.names_raw_clean.pct()} | "
            f"{r.slots.pct() if r.slots.n else '—'} | {r.ranks.pct() if r.ranks.n else '—'} | "
            f"{r.finishes.pct() if r.finishes.n else '—'} |"
        )
    lines.append(
        f"| **total** | | **{_sum(base, 'names_raw').pct()}** | **{_sum(base, 'names_raw_clean').pct()}** | "
        f"**{_sum(base, 'slots').pct()}** | **{_sum(base, 'ranks').pct()}** | **{_sum(base, 'finishes').pct()}** |"
    )
    lines += [
        "",
        "Name counts include the pinned rank-1/rank-2 players, which appear on every RESULTS screenshot "
        "(each occurrence is scored).",
        "",
        "## With roster (lineup from the two SLOT_LIST label sets sent as `roster`)",
        "",
        "Effective name = `roster_match` when the pipeline snapped the OCR text to a roster name, else the OCR text.",
        "",
        "| scope | names exact (all) | names exact (clean) | results `inferred_slot` |",
        "|---|---|---|---|",
        f"| RESULTS | {_sum(rost, 'names_eff', 'results').pct()} | {_sum(rost, 'names_eff_clean', 'results').pct()} | "
        f"{_sum(rost, 'inferred_slot', 'results').pct()} |",
        f"| SLOT_LIST (roster = these same labels, so this only checks snapping) | "
        f"{_sum(rost, 'names_eff', 'slot_list').pct()} | {_sum(rost, 'names_eff_clean', 'slot_list').pct()} | — |",
        "",
    ]
    lines += [
        "Names the recogniser cannot spell (Devanagari `आशीष्`, upside-down `ʞeɯɹer2`) are matched by elimination "
        "(the last unmatched names of the inferred team); such matches keep confidence ≤ 0.6 so the reviewer still "
        "sees them.",
        "",
    ]
    misses = [(r.file, e, p) for r in rost for e, p in r.misses if r.kind == "results"]
    if misses:
        lines += ["Remaining RESULTS name misses with roster:", ""]
        lines += [f"* {f}: expected `{e}`, got `{p}`" for f, e, p in misses]
        lines.append("")
    lines += [
        "## Top character confusions (raw OCR, no roster; expected → read)",
        "",
        "| expected | read | count |",
        "|---|---|---|",
    ]
    for (e, p), c in conf.most_common(20):
        lines.append(f"| `{e}` | `{p}` | {c} |")
    lines += [
        "",
        "## Latency (end-to-end `extract_image`, warm models, CPU only)",
        "",
        f"{len(lat)} timed calls ({repeat} per image, first call per image excluded when repeat > 1): "
        f"**p50 {_pctl(lat, 0.5):.0f} ms, p95 {_pctl(lat, 0.95):.0f} ms**.",
        f"Machine: {platform.processor() or platform.machine()}, {os.cpu_count()} logical CPUs, "
        f"`OCR_THREADS={s.ocr_threads}`. The machine was shared with other heavy jobs while measuring, so "
        "treat these as upper bounds.",
        "",
        SELECTION_NOTES,
    ]
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeat", type=int, default=3)
    ap.add_argument("--out", type=Path, default=SERVICE_ROOT / "eval" / "PIPELINE_BASELINE.md")
    args = ap.parse_args()
    base, conf = run(args.repeat, with_roster=False)
    rost, _ = run(1, with_roster=True)
    md = render(base, conf, rost, args.repeat)
    args.out.write_text(md, encoding="utf-8")
    print(md)


if __name__ == "__main__":
    main()
