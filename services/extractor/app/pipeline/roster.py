"""Snap OCR names to known players: the request roster (slot -> names) and the bundle lexicon.

Scoring compares *canonical* forms (case-folded, lookalikes collapsed: 0/O/o/D, 1/I/l/i/|, 5/S, 8/B, 2/Z,
spaces and separators removed) so the glyph ambiguities of the BGMI font do not cost points:
    score = w * WRatio + (1 - w) * normalized Levenshtein similarity      (0-100)

SLOT_LIST: names are matched within the extracted slot first, then across the roster, then the lexicon.
RESULTS:   every name is matched across the roster; the row's `inferred_slot` is the majority slot; names
           are then re-assigned one-to-one within that slot.
"""

from __future__ import annotations

import unicodedata
from collections import Counter
from dataclasses import dataclass
from typing import Any

from rapidfuzz import fuzz
from rapidfuzz.distance import Levenshtein

from app.schemas import Roster

_CANON = str.maketrans(
    {
        "0": "o",
        "d": "o",
        "q": "o",
        "ø": "o",
        "ö": "o",
        "ó": "o",
        "ò": "o",
        "1": "l",
        "i": "l",
        "!": "l",
        "í": "l",
        "ì": "l",
        "j": "l",
        "5": "s",
        "8": "b",
        "2": "z",
        "9": "g",
        "v": "y",
        "ü": "u",
        "û": "u",
        "ú": "u",
        "ù": "u",
        "ā": "a",
        "ä": "a",
        "â": "a",
        "á": "a",
        "ã": "a",
    }
)
_DROP = set(" ·•・._-~'`\"‿|")  # separators / decorations OCR often drops or invents


def canonical(s: str) -> str:
    s = unicodedata.normalize("NFC", s).casefold().replace("×", "x")
    return "".join(c for c in s if c not in _DROP).translate(_CANON)


def score(a: str, b: str, w: float) -> float:
    if a == b:
        return 100.0
    ca, cb = canonical(a), canonical(b)
    if not ca or not cb:
        return 0.0
    if ca == cb:
        return 99.0
    return w * float(fuzz.WRatio(ca, cb)) + (1 - w) * 100.0 * float(Levenshtein.normalized_similarity(ca, cb))


@dataclass(frozen=True)
class Candidate:
    name: str
    slot: int | None  # None for lexicon entries


@dataclass
class Match:
    name: str
    slot: int | None
    score: float
    by_elimination: bool = False  # paired only because it was the remaining lineup name -> needs review


class Matcher:
    def __init__(self, roster: Roster | None, lexicon: tuple[str, ...], cfg: dict[str, Any]) -> None:
        self.cfg = cfg
        self.w = float(cfg["wratio_weight"])
        self.roster: list[Candidate] = []
        if roster:
            for rs in roster.slots:
                for p in rs.players:
                    if p and p.strip():
                        self.roster.append(Candidate(unicodedata.normalize("NFC", p.strip()), rs.slot))
        seen = {c.name for c in self.roster}
        self.lexicon = [
            Candidate(n, None)
            for n in dict.fromkeys(unicodedata.normalize("NFC", x) for x in lexicon)
            if n and n not in seen
        ]

    @property
    def has_roster(self) -> bool:
        return bool(self.roster)

    def _best(self, text: str, cands: list[Candidate], accept: float) -> Match | None:
        if not text or not cands:
            return None
        scored = sorted(((score(text, c.name, self.w), c) for c in cands), key=lambda t: -t[0])
        best_s, best = scored[0]
        if best_s < accept:
            return None
        # ambiguity: a different name nearly as good (from another slot) -> no snap
        for s, c in scored[1:]:
            if c.name != best.name and c.slot != best.slot and best_s - s < float(self.cfg["margin"]):
                return None
            if best_s - s >= float(self.cfg["margin"]):
                break
        return Match(best.name, best.slot, best_s)

    def match_one(self, text: str, slot: int | None = None) -> Match | None:
        """Best snap for one OCR name; `slot` (when known) restricts the first pass to that slot."""
        acc = float(self.cfg["accept_score"])
        if slot is not None:
            in_slot = [c for c in self.roster if c.slot == slot]
            m = self._best(text, in_slot, acc)
            if m:
                return m
        m = self._best(text, self.roster, acc)
        if m:
            return m
        return self._best(text, self.lexicon, float(self.cfg["lexicon_accept_score"]))

    def match_group(self, texts: list[str], slot: int | None) -> tuple[list[Match | None], int | None]:
        """Match a card/row of names. Returns per-name matches (one-to-one inside the group) and the slot
        (given, or inferred by majority vote over roster matches)."""
        first = [self.match_one(t) if t else None for t in texts]
        inferred = slot
        if inferred is None:
            votes = Counter(m.slot for m in first if m and m.slot is not None)
            if votes:
                top, n = votes.most_common(1)[0]
                min_votes = min(int(self.cfg["slot_vote_min"]), sum(1 for t in texts if t))
                if n >= min_votes and (len(votes) == 1 or n > votes.most_common(2)[1][1]):
                    inferred = top
        if inferred is None:
            return first, None
        # one-to-one assignment within the slot (greedy on score), others fall back to their own best match
        in_slot = [c for c in self.roster if c.slot == inferred]
        acc = float(self.cfg["accept_score"])
        pairs = sorted(
            ((score(t, c.name, self.w), i, c) for i, t in enumerate(texts) if t for c in in_slot),
            key=lambda p: -p[0],
        )
        out: list[Match | None] = [None] * len(texts)
        used: set[str] = set()
        for s, i, c in pairs:
            if s < acc or out[i] is not None or c.name in used:
                continue
            out[i] = Match(c.name, c.slot, s)
            used.add(c.name)
        # elimination: the lineup of this slot is known, so names left over on both sides pair up by best
        # score with a much lower bar (e.g. Devanagari / upside-down names the recogniser cannot spell)
        left_t = [i for i, t in enumerate(texts) if t and out[i] is None]
        left_c = [c for c in in_slot if c.name not in used]
        if left_t and left_c and len(left_t) <= len(left_c):
            low = float(self.cfg["leftover_accept_score"])
            rest = sorted(
                ((score(texts[i], c.name, self.w), i, c) for i in left_t for c in left_c), key=lambda p: -p[0]
            )
            for s, i, c in rest:
                if s < low or out[i] is not None or c.name in used:
                    continue
                out[i] = Match(c.name, c.slot, s, by_elimination=True)
                used.add(c.name)
            # last one standing: one unread name, one unused roster name of this slot -> they are the same
            left_t = [i for i in left_t if out[i] is None]
            left_c = [c for c in left_c if c.name not in used]
            if len(left_t) == 1 and len(left_c) == 1:
                i, c = left_t[0], left_c[0]
                out[i] = Match(c.name, c.slot, score(texts[i], c.name, self.w), by_elimination=True)
                used.add(c.name)
        for i, t in enumerate(texts):
            if out[i] is None and t:
                m = first[i]
                if m and m.name not in used and (m.slot is None or m.slot == inferred):
                    out[i] = m
                elif m is None:
                    out[i] = self._best(t, self.lexicon, float(self.cfg["lexicon_accept_score"]))
        return out, inferred
