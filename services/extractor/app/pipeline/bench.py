# ruff: noqa: E501  (markdown report text)
"""Measure the pipeline on hand-labelled screenshots.

    uv run python -m app.pipeline.bench                       # real/ + testingss/ -> eval/PIPELINE_BASELINE.md
    uv run python -m app.pipeline.bench --dataset eval/dataset/testingss [--groups g10,g16] [--misses]

`--dataset` takes a directory with a labels.json (format of eval/dataset/real/labels.json) or a directory of
groups (gXX/labels.json); groups without labels are skipped. Every number is computed from the labels.

Alignment: SLOT_LIST teams are matched by slot value (falling back to card order), RESULTS rows by rank
value (falling back to on-screen order); players by position inside a card/row (players whose name renders
blank are skipped by both the labels and the pipeline). The roster for a group is that group's own
SLOT_LIST labels (no SLOT_LIST in the group -> no roster run).
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
from app.schemas import Extraction, ResultRowOut, Roster, RosterSlot, TeamOut
from app.settings import SERVICE_ROOT, get_settings

DATASET = SERVICE_ROOT / "eval" / "dataset" / "real"
TESTINGSS = SERVICE_ROOT / "eval" / "dataset" / "testingss"


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


@dataclass
class Tally:
    ok: int = 0
    n: int = 0

    def add(self, good: bool) -> None:
        self.ok += int(good)
        self.n += 1

    def __iadd__(self, o: Tally) -> Tally:
        self.ok += o.ok
        self.n += o.n
        return self

    def pct(self) -> str:
        return f"{100.0 * self.ok / self.n:.1f}% ({self.ok}/{self.n})" if self.n else "—"


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
    other_misses: list[str] = field(default_factory=list)


TALLIES = (
    "names_raw",
    "names_raw_clean",
    "names_eff",
    "names_eff_clean",
    "slots",
    "ranks",
    "finishes",
    "inferred_slot",
)


def roster_from_labels(labels: dict[str, Any]) -> Roster:
    slots: dict[int, list[str]] = {}
    for im in labels["images"]:
        if im["kind"] == "SLOT_LIST":
            for t in im["teams"]:
                # a group may hold several lobbies (g21): keep every name seen on a slot, in order
                names = slots.setdefault(int(t["slot"]), [])
                names += [nfc(p) for p in t["players"] if nfc(p) not in names]
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
        by_slot: dict[int, TeamOut] = {}
        for team in ex.teams:
            if team.slot is not None:
                by_slot.setdefault(team.slot, team)
        for i, t in enumerate(im["teams"]):
            pt: TeamOut | None = by_slot.get(t["slot"]) or (ex.teams[i] if i < len(ex.teams) else None)
            ok = pt is not None and pt.slot == t["slot"]
            rep.slots.add(ok)
            if not ok:
                rep.other_misses.append(f"slot {t['slot']} -> {pt.slot if pt else 'missing'}")
            for j, exp in enumerate(t["players"]):
                pp = pt.players[j] if pt and j < len(pt.players) else None
                name_check(pp.name if pp else "", (pp.roster_match or pp.name) if pp else "", exp)
        return
    rows = sorted(im["rows"], key=lambda r: r["rank"])
    by_rank: dict[int, ResultRowOut] = {}
    for row in ex.rows:
        if row.rank is not None:
            by_rank.setdefault(row.rank, row)
    for i, r in enumerate(rows):
        pr: ResultRowOut | None = by_rank.get(r["rank"]) or (ex.rows[i] if i < len(ex.rows) else None)
        ok = pr is not None and pr.rank == r["rank"]
        rep.ranks.add(ok)
        if not ok:
            rep.other_misses.append(f"rank {r['rank']} -> {pr.rank if pr else 'missing'}")
        exp_slots = Counter(slot_of.get(nfc(p["name"])) for p in r["players"])
        exp_slot = exp_slots.most_common(1)[0][0] if exp_slots else None
        if exp_slot is not None:
            rep.inferred_slot.add(pr is not None and pr.inferred_slot == exp_slot)
        for j, p in enumerate(r["players"]):
            pp = pr.players[j] if pr and j < len(pr.players) else None
            name_check(pp.name if pp else "", (pp.roster_match or pp.name) if pp else "", p["name"])
            good = pp is not None and pp.kills == p["kills"]
            rep.finishes.add(good)
            if not good:
                rep.other_misses.append(
                    f"rank {r['rank']} {p['name']!r}: finishes {p['kills']} -> {pp.kills if pp else 'missing'}"
                )


@dataclass
class GroupResult:
    name: str
    base: list[ImageReport]
    rost: list[ImageReport] | None
    conf: Counter[tuple[str, str]]

    def total(self, attr: str, reports: list[ImageReport] | None = None) -> Tally:
        t = Tally()
        for r in self.base if reports is None else reports:
            t += getattr(r, attr)
        return t


def run_group(name: str, ddir: Path, repeat: int = 1, roster_runs: bool = True) -> GroupResult:
    labels = json.loads((ddir / "labels.json").read_text(encoding="utf-8"))
    flagged = {nfc(n) for n in labels.get("needs_human_check", [])}
    roster = roster_from_labels(labels)
    slot_of = {p: s.slot for s in roster.slots for p in s.players}
    conf: Counter[tuple[str, str]] = Counter()
    base: list[ImageReport] = []
    rost: list[ImageReport] | None = [] if (roster_runs and roster.slots) else None
    for im in labels["images"]:
        data = (ddir / im["file"]).read_bytes()
        kind = "slot_list" if im["kind"] == "SLOT_LIST" else "results"
        rep = ImageReport(f"{name}/{im['file']}", kind)
        ex: Extraction | None = None
        for _ in range(max(1, repeat)):
            t0 = time.perf_counter()
            ex = extract_image(data, kind)  # type: ignore[arg-type]
            rep.latencies.append((time.perf_counter() - t0) * 1000)
        assert ex is not None
        score(ex, im, flagged, slot_of, rep, conf)
        base.append(rep)
        if rost is not None:
            rr = ImageReport(rep.file, kind)
            score(extract_image(data, kind, roster), im, flagged, slot_of, rr, Counter())  # type: ignore[arg-type]
            rost.append(rr)
    return GroupResult(name, base, rost, conf)


def discover(path: Path, groups: set[str] | None = None) -> list[tuple[str, Path]]:
    if (path / "labels.json").exists():
        return [(path.name, path)]
    out = []
    for d in sorted(p for p in path.iterdir() if p.is_dir()):
        if (d / "labels.json").exists() and (groups is None or d.name in groups):
            out.append((d.name, d))
    return out


def _pctl(values: list[float], q: float) -> float:
    s = sorted(values)
    if not s:
        return 0.0
    k = (len(s) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def group_table(results: list[GroupResult]) -> list[str]:
    lines = [
        "| group | images | slots | ranks | finishes | names exact (all) | names exact (clean) | with roster: names (all) | with roster: names (clean) | with roster: `inferred_slot` |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    tot = {a: Tally() for a in TALLIES}
    tot_r = {a: Tally() for a in TALLIES}
    n_img = 0
    for g in results:
        n_img += len(g.base)
        for a in TALLIES:
            tot[a] += g.total(a)
            if g.rost is not None:
                tot_r[a] += g.total(a, g.rost)
        r = (lambda a, g=g: g.total(a, g.rost).pct()) if g.rost is not None else (lambda a: "no roster")
        lines.append(
            f"| {g.name} | {len(g.base)} | {g.total('slots').pct()} | {g.total('ranks').pct()} | "
            f"{g.total('finishes').pct()} | {g.total('names_raw').pct()} | {g.total('names_raw_clean').pct()} | "
            f"{r('names_eff')} | {r('names_eff_clean')} | {r('inferred_slot') if g.rost is not None else '—'} |"
        )
    lines.append(
        f"| **total** | {n_img} | **{tot['slots'].pct()}** | **{tot['ranks'].pct()}** | **{tot['finishes'].pct()}** | "
        f"**{tot['names_raw'].pct()}** | **{tot['names_raw_clean'].pct()}** | **{tot_r['names_eff'].pct()}** | "
        f"**{tot_r['names_eff_clean'].pct()}** | **{tot_r['inferred_slot'].pct()}** |"
    )
    return lines


def misses_report(results: list[GroupResult], limit: int = 400) -> list[str]:
    out: list[str] = []
    for g in results:
        for r in g.base:
            for m in r.other_misses:
                out.append(f"* {r.file}: {m}")
    return out[:limit]


# Recorded once while choosing the defaults (real/ only). Kept verbatim so the choice is auditable.
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


def render_real(g: GroupResult, repeat: int) -> list[str]:
    s = get_settings()
    lat = [v for r in g.base for v in (r.latencies[1:] or r.latencies)]
    lines = [
        "## real/ — 7 phone screenshots (1600x720)",
        "",
        "Ground-truth names listed in `needs_human_check` are uncertain glyph readings (I/l/1, O/0, unusual "
        "Unicode); accuracy is reported over all names and over the *clean* names (flagged ones excluded).",
        "",
        "| image | kind | names exact (all) | names exact (clean) | slots | ranks | finishes |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in g.base:
        lines.append(
            f"| {r.file.split('/')[-1]} | {r.kind} | {r.names_raw.pct()} | {r.names_raw_clean.pct()} | "
            f"{r.slots.pct()} | {r.ranks.pct()} | {r.finishes.pct()} |"
        )
    lines.append(
        f"| **total** | | **{g.total('names_raw').pct()}** | **{g.total('names_raw_clean').pct()}** | "
        f"**{g.total('slots').pct()}** | **{g.total('ranks').pct()}** | **{g.total('finishes').pct()}** |"
    )
    rost = g.rost or []
    res = [r for r in rost if r.kind == "results"]
    sl = [r for r in rost if r.kind == "slot_list"]
    lines += [
        "",
        "With roster (lineup from the two SLOT_LIST label sets; effective name = `roster_match` when snapped, "
        "else the OCR text):",
        "",
        "| scope | names exact (all) | names exact (clean) | results `inferred_slot` |",
        "|---|---|---|---|",
        f"| RESULTS | {g.total('names_eff', res).pct()} | {g.total('names_eff_clean', res).pct()} | {g.total('inferred_slot', res).pct()} |",
        f"| SLOT_LIST (roster = these same labels: checks snapping only) | {g.total('names_eff', sl).pct()} | {g.total('names_eff_clean', sl).pct()} | — |",
        "",
        "Names the recogniser cannot spell (Devanagari `आशीष्`, upside-down `ʞeɯɹer2`) are matched by elimination "
        "(the last unmatched names of the inferred team); such matches keep confidence ≤ 0.6 so the reviewer "
        "still sees them.",
        "",
    ]
    misses = [(r.file, e, p) for r in res for e, p in r.misses]
    if misses:
        lines += ["Remaining RESULTS name misses with roster:", ""]
        lines += [f"* {f}: expected `{e}`, got `{p}`" for f, e, p in misses]
        lines.append("")
    lines += [
        f"Latency ({len(lat)} timed calls, {repeat} per image, first call per image excluded): "
        f"**p50 {_pctl(lat, 0.5):.0f} ms, p95 {_pctl(lat, 0.95):.0f} ms** "
        f"({platform.processor() or platform.machine()}, {os.cpu_count()} logical CPUs, `OCR_THREADS={s.ocr_threads}`; "
        "the machine was shared with other heavy jobs, so treat these as upper bounds).",
        "",
    ]
    return lines


def render_groups(title: str, results: list[GroupResult], about: str) -> list[str]:
    conf: Counter[tuple[str, str]] = Counter()
    lat: list[float] = []
    for g in results:
        conf.update(g.conf)
        lat += [v for r in g.base for v in r.latencies]
    lines = [f"## {title}", "", about, "", *group_table(results), ""]
    lines += [
        f"Latency over these {len(lat)} calls: p50 {_pctl(lat, 0.5):.0f} ms, p95 {_pctl(lat, 0.95):.0f} ms.",
        "",
        "Top raw-OCR character confusions (expected → read): "
        + ", ".join(f"`{e}`→`{p}` {c}" for (e, p), c in conf.most_common(15)),
        "",
    ]
    other = misses_report(results)
    if other:
        lines += ["Slot / rank / finishes misses:", "", *other, ""]
    return lines


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", type=Path, help="labels dir, or a dir of gXX/labels.json groups")
    ap.add_argument("--groups", help="comma-separated group names to include")
    ap.add_argument("--repeat", type=int, default=3, help="timed runs per image for real/")
    ap.add_argument("--no-roster", action="store_true")
    ap.add_argument("--misses", action="store_true", help="also print every name miss")
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()
    s = get_settings()
    groups = set(args.groups.split(",")) if args.groups else None
    head = [
        "# Extractor pipeline baseline",
        "",
        f"Generated by `python -m app.pipeline.bench` on {time.strftime('%Y-%m-%d %H:%M')} — OCR model "
        f"`{s.ocr_rec_model}` (alt for low-confidence names: {', '.join(s.ocr_alt_rec_models) or 'none'}), "
        "layout `app/config/layout.yaml`, base bundle (no lexicon / char_fixes), VLM "
        f"{'on' if s.vlm_enabled else 'off'}. Every number below is measured against the hand labels.",
        "",
    ]
    if args.dataset:
        res = [run_group(n, d, 1, not args.no_roster) for n, d in discover(args.dataset, groups)]
        lines = render_groups(str(args.dataset), res, "")
        if args.misses:
            for g in res:
                for r in g.rost or g.base:
                    lines += [f"* {r.file}: expected `{e}`, got `{p}`" for e, p in r.misses]
        md = "\n".join(head + lines)
    else:
        real = run_group("real", DATASET, args.repeat, True)
        lines = render_real(real, args.repeat)
        if TESTINGSS.exists():
            res = [run_group(n, d, 1, not args.no_roster) for n, d in discover(TESTINGSS, groups)]
            about = (
                "Owner-provided screenshots, mostly iPad (1600x1199 / 2732x2048, BGMI often in a floating "
                "window), g21 phone (1600x720/717). Groups without a labels.json yet are not listed. The "
                "roster for a group is its own SLOT_LIST labels (groups that only have RESULTS show 'no roster')."
            )
            lines += render_groups("testingss/ — per group", res, about)
        md = "\n".join(head + lines + [SELECTION_NOTES])
        args.out = args.out or SERVICE_ROOT / "eval" / "PIPELINE_BASELINE.md"
    if args.out:
        args.out.write_text(md, encoding="utf-8")
    print(md)


if __name__ == "__main__":
    main()
