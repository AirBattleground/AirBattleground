"""Test double for the pipeline's `extract_image(image_bytes, kind, roster)`: "reads" an image by looking up
its labels (by sha256) and corrupts names deterministically like a real OCR would (O→0 and l→1 inside words),
then applies the active bundle's char_fixes and lexicon exactly as the pipeline contract describes."""

from __future__ import annotations

import hashlib
import time
from typing import Any

from rapidfuzz import fuzz, process

from app.bundle import active_bundle
from app.schemas import Extraction, PlayerOut, ResultRowOut, Roster, TeamOut
from app.training.samples import Sample


def corrupt(name: str) -> str:
    out = []
    for i, c in enumerate(name):
        prev = name[i - 1] if i else ""
        if c == "O" and prev.isalpha():
            out.append("0")
        elif c == "l" and prev.isalpha():
            out.append("1")
        else:
            out.append(c)
    return "".join(out)


def apply_fixes(name: str, fixes: dict[str, Any]) -> str:
    chars = list(name)
    for key, rule in fixes.items():
        src, dst = key.split("->")
        for i, c in enumerate(chars):
            if c != src:
                continue
            prev = chars[i - 1] if i else ""
            if rule.get("context") == "letters" and not prev.isalpha():
                continue
            chars[i] = dst
    return "".join(chars)


class FakePipeline:
    def __init__(self, samples: list[Sample], snap: bool = True) -> None:
        self.by_sha = {hashlib.sha256(s.image_bytes()).hexdigest(): s for s in samples}
        self.snap = snap
        self.calls = 0

    def __call__(self, data: bytes, kind: str, roster: Roster | None) -> Extraction:
        self.calls += 1
        time.sleep(0.001)
        b = active_bundle()
        s = self.by_sha[hashlib.sha256(data).hexdigest()]
        known = list(b.lexicon) + ([p for sl in roster.slots for p in sl.players] if roster else [])

        def player(name: str, kills: int | None = None) -> PlayerOut:
            read = apply_fixes(corrupt(name), b.char_fixes)
            match = None
            if self.snap and known:
                hit = process.extractOne(read, known, scorer=fuzz.ratio)
                if hit and hit[1] >= 85:
                    match = hit[0]
            return PlayerOut(name=read, confidence=0.9, roster_match=match, kills=kills)

        if s.kind == "slot_list":
            teams = [
                TeamOut(slot=t["slot"], slot_confidence=0.99, players=[player(p) for p in t["players"]])
                for t in s.labels["teams"]
            ]
            return Extraction(
                image_id=s.id, kind="slot_list", model_version=b.version, teams=teams, needs_review=False
            )
        rows = [
            ResultRowOut(
                rank=r["rank"],
                rank_confidence=0.99,
                players=[player(p["name"], p["kills"]) for p in r["players"]],
            )
            for r in s.labels["rows"]
        ]
        return Extraction(
            image_id=s.id, kind="results", model_version=b.version, rows=rows, needs_review=False
        )
