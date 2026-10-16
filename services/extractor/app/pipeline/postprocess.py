"""Clean OCR text: Unicode normalisation, edge noise, bundle char_fixes, numbers ("5 finishes" -> 5)."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping
from typing import Any

_WS = re.compile(r"\s+")

# characters OCR commonly returns for digits in this game font (digits-only paths: slot, rank, finishes)
DIGIT_LOOKALIKES: dict[str, str] = {
    "O": "0",
    "o": "0",
    "D": "0",
    "Q": "0",
    "I": "1",
    "l": "1",
    "|": "1",
    "i": "1",
    "!": "1",
    "T": "7",
    "Z": "2",
    "z": "2",
    "S": "5",
    "s": "5",
    "B": "8",
    "g": "9",
    "q": "9",
    "G": "6",
    "b": "6",
}

_FINISH_RE = re.compile(r"^\s*([0-9OoDQIl|i!SsBZzgqGbA]{1,2})\s*[fF]", re.UNICODE)


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def clean_name(raw: str, edge_noise: str, max_len: int) -> str:
    """NFC, collapse whitespace, strip noise characters from both ends (never from the middle)."""
    s = _WS.sub(" ", nfc(raw)).strip()
    s = s.strip(edge_noise + " ")
    return s[:max_len]


def _is_letter(c: str) -> bool:
    return unicodedata.category(c).startswith("L")


def _context_ok(s: str, i: int, n: int, context: str) -> bool:
    prev = s[i - 1] if i > 0 else ""
    nxt = s[i + n] if i + n < len(s) else ""
    neighbours = [c for c in (prev, nxt) if c]
    if context == "letters":
        return bool(neighbours) and all(_is_letter(c) for c in neighbours)
    if context == "digits":
        return bool(neighbours) and all(c.isdigit() for c in neighbours)
    if context == "start":
        return i == 0
    if context == "end":
        return i + n == len(s)
    return True  # "any"


def apply_char_fixes(s: str, fixes: Mapping[str, Any]) -> str:
    """Apply bundle lookalike rules.

    Format (written by app/training adaptive trainer): {"<pred>-><expected>": {"context": ctx, ...}} where
    ctx is "letters" (both existing neighbours are letters), "digits" (both are digits), "start", "end" or
    "any". Rules are applied left to right on the original string (no cascading).
    """
    if not fixes or not s:
        return s
    rules: list[tuple[str, str, str]] = []
    for key, spec in fixes.items():
        if "->" not in key:
            continue
        pred, exp = key.split("->", 1)
        if not pred:
            continue
        ctx = str(spec.get("context", "any")) if isinstance(spec, Mapping) else "any"
        rules.append((pred, exp, ctx))
    rules.sort(key=lambda r: -len(r[0]))
    out: list[str] = []
    i = 0
    while i < len(s):
        for pred, exp, ctx in rules:
            if s.startswith(pred, i) and _context_ok(s, i, len(pred), ctx):
                out.append(exp)
                i += len(pred)
                break
        else:
            out.append(s[i])
            i += 1
    return "".join(out)


def parse_int(raw: str, lo: int, hi: int) -> int | None:
    """Digits-only reading (slot / rank numbers). Lookalike letters are mapped to digits."""
    s = "".join(DIGIT_LOOKALIKES.get(c, c) for c in nfc(raw) if not c.isspace())
    digits = "".join(c for c in s if c.isdigit())
    if not digits or len(digits) > 3:
        return None
    v = int(digits)
    return v if lo <= v <= hi else None


def parse_finishes(raw: str, max_kills: int = 99) -> int | None:
    """ "5 finishes" / "1 finish" / OCR variants ("Ofinishes", "l finish", "I finish") -> int."""
    s = nfc(raw).strip()
    low = s.lower()
    if "finish" in low and "finishes" not in low:
        return 1  # the game writes the singular only for exactly one finish
    m = _FINISH_RE.match(s)
    if m:
        token = m.group(1)
    else:
        # no "f..." tail recognised: accept a bare number
        m2 = re.match(r"^\s*([0-9]{1,2})\s*$", s)
        if not m2:
            return None
        token = m2.group(1)
    digits = "".join(DIGIT_LOOKALIKES.get(c, c) for c in token)
    if not digits.isdigit():
        return None
    v = int(digits)
    return v if 0 <= v <= max_kills else None


def finishes_consistent(raw: str, value: int) -> bool:
    """'finish' (singular) must go with 1, 'finishes' with anything else. Used to adjust confidence."""
    s = nfc(raw).lower()
    if "finishes" in s:
        return value != 1
    if "finish" in s:
        return value == 1
    return True
