"""Evaluation math: align an Extraction against labels and compute name/slot/rank/finishes metrics.

Pure functions (no OCR) so they are unit-testable. Conventions:
  * a name is "exact" when NFC(predicted) == NFC(expected). The predicted name is the *effective* name the
    product would show: `roster_match` when present (roster/lexicon snapping), else the OCR `name`.
    The raw OCR `name` is scored separately (`ocr_name_exact`) so the effect of snapping is visible.
  * CER = sum(Levenshtein(pred, gt)) / sum(len(gt)) over expected names (micro average). A missed name
    counts as pred = "" (CER contribution 1.0 per char).
  * Groups (slot-list teams / result rows) are paired by name similarity, not by their slot/rank, so a
    wrongly read slot digit is scored as a slot error rather than breaking the name pairing.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from rapidfuzz.distance import Levenshtein

from app.schemas import EvalMetrics, Extraction, Kind, PlayerOut, Roster
from app.training.samples import Split, nfc

EMPTY = "∅"


def edit_distance(a: str, b: str) -> int:
    return int(Levenshtein.distance(a, b))


def cer(pred: str, gt: str) -> float:
    if not gt:
        return 0.0 if not pred else 1.0
    return edit_distance(pred, gt) / len(gt)


def similarity(a: str, b: str) -> float:
    if not a and not b:
        return 1.0
    return 1.0 - edit_distance(a, b) / max(len(a), len(b))


def char_confusions(pred: str, gt: str) -> list[tuple[str, str]]:
    """(expected_char, predicted_char) for every edit; EMPTY marks insertion/deletion."""
    out: list[tuple[str, str]] = []
    for op in Levenshtein.editops(gt, pred):
        if op.tag == "replace":
            out.append((gt[op.src_pos], pred[op.dest_pos]))
        elif op.tag == "delete":
            out.append((gt[op.src_pos], EMPTY))
        else:
            out.append((EMPTY, pred[op.dest_pos]))
    return out


@dataclass
class NamePair:
    expected: str
    predicted: str  # effective (roster_match or name)
    raw: str  # OCR name field
    confidence: float
    flagged: bool
    kills_expected: int | None = None
    kills_predicted: int | None = None

    @property
    def exact(self) -> bool:
        return self.predicted == self.expected

    @property
    def raw_exact(self) -> bool:
        return self.raw == self.expected


@dataclass
class GroupScore:
    key_expected: int | None  # slot (slot_list) or rank (results)
    key_predicted: int | None
    slot_expected: int | None = None
    slot_predicted: int | None = None


@dataclass
class ImageScore:
    sample_id: str
    kind: Kind
    split: Split
    synthetic: bool
    names: list[NamePair] = field(default_factory=list)
    groups: list[GroupScore] = field(default_factory=list)
    extra_names: int = 0
    latency_ms: float = 0.0
    error: str | None = None
    warnings: list[str] = field(default_factory=list)


def _effective(p: PlayerOut) -> str:
    return nfc(p.roster_match or p.name or "")


def _pair_greedy(score: list[list[float]]) -> list[tuple[int, int]]:
    cand = sorted(
        ((s, i, j) for i, row in enumerate(score) for j, s in enumerate(row)),
        key=lambda t: (-t[0], abs(t[1] - t[2])),
    )
    used_i: set[int] = set()
    used_j: set[int] = set()
    pairs = []
    for _s, i, j in cand:
        if i in used_i or j in used_j:
            continue
        used_i.add(i)
        used_j.add(j)
        pairs.append((i, j))
    return pairs


def _slot_of_names(names: list[str], roster: Roster | None) -> int | None:
    if roster is None:
        return None
    votes: Counter[int] = Counter()
    for s in roster.slots:
        rn = {nfc(p) for p in s.players}
        votes[s.slot] += sum(1 for n in names if n in rn)
    if not votes:
        return None
    slot, n = votes.most_common(1)[0]
    return slot if n > 0 else None


def score_image(
    *,
    sample_id: str,
    kind: Kind,
    split: Split,
    labels: dict[str, Any],
    extraction: Extraction | None,
    flagged: frozenset[str] = frozenset(),
    synthetic: bool = False,
    latency_ms: float = 0.0,
    roster: Roster | None = None,
    error: str | None = None,
) -> ImageScore:
    res = ImageScore(
        sample_id=sample_id, kind=kind, split=split, synthetic=synthetic, latency_ms=latency_ms, error=error
    )
    # expected groups: (key, slot, [(name, kills)])
    exp: list[tuple[int | None, int | None, list[tuple[str, int | None]]]] = []
    if kind == "slot_list":
        for t in labels.get("teams", []):
            exp.append((int(t["slot"]), int(t["slot"]), [(nfc(p), None) for p in t.get("players", [])]))
    else:
        for r in labels.get("rows", []):
            players = [
                (nfc(p["name"]), int(p["kills"]) if p.get("kills") is not None else None)
                if isinstance(p, dict)
                else (nfc(p), None)
                for p in r.get("players", [])
            ]
            exp.append(
                (
                    int(r["rank"]) if r.get("rank") is not None else None,
                    _slot_of_names([n for n, _ in players], roster),
                    players,
                )
            )

    pred: list[tuple[int | None, int | None, list[PlayerOut]]] = []
    if extraction is not None:
        res.warnings = list(extraction.warnings)
        if kind == "slot_list":
            pred = [(t.slot, t.slot, t.players) for t in extraction.teams]
        else:
            pred = [(r.rank, r.inferred_slot, r.players) for r in extraction.rows]

    def group_sim(e: list[tuple[str, int | None]], p: list[PlayerOut]) -> float:
        return sum(max((similarity(n, _effective(q)) for q in p), default=0.0) for n, _ in e)

    gscore = [[group_sim(e[2], p[2]) + (0.25 if e[0] == p[0] else 0.0) for p in pred] for e in exp]
    gpairs = dict(_pair_greedy(gscore)) if pred else {}

    for gi, (key, slot, players) in enumerate(exp):
        pj = gpairs.get(gi)
        if pj is not None and gscore[gi][pj] <= 0.0:
            pj = None
        pplayers = pred[pj][2] if pj is not None else []
        res.groups.append(
            GroupScore(
                key_expected=key,
                key_predicted=pred[pj][0] if pj is not None else None,
                slot_expected=slot,
                slot_predicted=pred[pj][1] if pj is not None else None,
            )
        )
        nscore = [[similarity(n, _effective(q)) for q in pplayers] for n, _ in players]
        npairs = dict(_pair_greedy(nscore)) if pplayers else {}
        for ni, (name, kills) in enumerate(players):
            qj = npairs.get(ni)
            q = pplayers[qj] if qj is not None else None
            res.names.append(
                NamePair(
                    expected=name,
                    predicted=_effective(q) if q else "",
                    raw=nfc(q.name) if q else "",
                    confidence=q.confidence if q else 0.0,
                    flagged=name in flagged,
                    kills_expected=kills,
                    kills_predicted=q.kills if q else None,
                )
            )
        res.extra_names += max(0, len(pplayers) - len(npairs))
    # predicted groups that matched nothing are hallucinations / partial blocks
    for pj, p in enumerate(pred):
        if pj not in gpairs.values():
            res.extra_names += len(p[2])
    return res


def _ratio(num: int, den: int) -> float | None:
    return num / den if den else None


def _percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    v = sorted(values)
    k = (len(v) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (k - lo)


def aggregate(
    scores: list[ImageScore], *, exclude_flagged: bool = False, top_confusions: int = 15
) -> dict[str, Any]:
    names = [n for s in scores for n in s.names if not (exclude_flagged and n.flagged)]
    gt_chars = sum(len(n.expected) for n in names)
    edits = sum(edit_distance(n.predicted, n.expected) for n in names)
    raw_edits = sum(edit_distance(n.raw, n.expected) for n in names)
    card_slots = [g for s in scores if s.kind == "slot_list" for g in s.groups if g.slot_expected is not None]
    row_slots = [g for s in scores if s.kind == "results" for g in s.groups if g.slot_expected is not None]
    rank_groups = [g for s in scores if s.kind == "results" for g in s.groups if g.key_expected is not None]
    kills = [n for n in names if n.kills_expected is not None]
    conf: Counter[str] = Counter()
    for n in names:
        if not n.raw_exact:
            for e, p in char_confusions(n.raw, n.expected):
                conf[f"{e}→{p}"] += 1
    lat = [s.latency_ms for s in scores if s.error is None]
    return {
        "images": len(scores),
        "images_failed": sum(1 for s in scores if s.error),
        "names": len(names),
        "name_exact": _ratio(sum(n.exact for n in names), len(names)),
        "ocr_name_exact": _ratio(sum(n.raw_exact for n in names), len(names)),
        "cer": edits / gt_chars if gt_chars else None,
        "ocr_cer": raw_edits / gt_chars if gt_chars else None,
        "missed_names": sum(1 for n in names if not n.raw),
        "extra_names": sum(s.extra_names for s in scores),
        # slot digits read from slot-list cards
        "slot_accuracy": _ratio(
            sum(g.slot_predicted == g.slot_expected for g in card_slots), len(card_slots)
        ),
        "slots": len(card_slots),
        # results rows: slot inferred by matching names to the lineup (only possible with a roster)
        "row_slot_accuracy": _ratio(
            sum(g.slot_predicted == g.slot_expected for g in row_slots), len(row_slots)
        ),
        "row_slots": len(row_slots),
        "rank_accuracy": _ratio(
            sum(g.key_predicted == g.key_expected for g in rank_groups), len(rank_groups)
        ),
        "ranks": len(rank_groups),
        "finishes_accuracy": _ratio(sum(n.kills_predicted == n.kills_expected for n in kills), len(kills)),
        "finishes": len(kills),
        "latency_ms_p50": _percentile(lat, 0.5),
        "latency_ms_p95": _percentile(lat, 0.95),
        "top_confusions": conf.most_common(top_confusions),
    }


def to_eval_metrics(agg: dict[str, Any], split: Split) -> EvalMetrics:
    return EvalMetrics(
        name_exact=float(agg["name_exact"] or 0.0),
        cer=float(agg["cer"] if agg["cer"] is not None else 1.0),
        # contract has one slot field: card slot digits when the set has slot lists, else inferred row slots
        slot_accuracy=float((agg["slot_accuracy"] if agg["slots"] else agg["row_slot_accuracy"]) or 0.0),
        kills_accuracy=agg["finishes_accuracy"],
        rank_accuracy=agg["rank_accuracy"],
        names=int(agg["names"]),
        images=int(agg["images"]),
        split=split,
    )
