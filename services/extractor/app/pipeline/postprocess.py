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


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def _wide(c: str) -> bool:
    return len(c) == 1 and unicodedata.east_asian_width(c) == "F"  # fullwidth Latin (Ｍｒ·ＬａＬａ)


def space_separators(s: str, seps: str) -> str:
    """Clan separators are drawn with a space on each side in BGMI ("WRG | GHOST", "HaVoC · SLĀYER",
    "· Titann ·": 60 of 61 labelled names); the recogniser often drops those spaces. Fullwidth neighbours
    (e.g. "Ｍｒ·ＬａＬａ") are left alone."""
    if not seps or not s:
        return s
    out: list[str] = []
    for i, c in enumerate(s):
        if c in seps:
            prev = s[i - 1] if i > 0 else ""
            nxt = s[i + 1] if i + 1 < len(s) else ""
            if _wide(prev) or _wide(nxt):
                out.append(c)
                continue
            if out and out[-1] != " ":
                out.append(" ")
            out.append(c)
            if nxt and nxt != " ":
                out.append(" ")
        else:
            out.append(c)
    return "".join(out)


def clean_name(
    raw: str,
    edge_noise: str,
    max_len: int,
    char_map: dict[str, str] | None = None,
    spaced_separators: str = "",
) -> str:
    """NFC, map OCR variants, collapse whitespace, strip noise characters from both ends (never from the
    middle), restore the spaces around clan separators."""
    s = nfc(raw)
    if char_map:
        s = "".join(char_map.get(c, c) for c in s)
    s = _WS.sub(" ", s).strip()
    s = s.strip(edge_noise + " ")
    s = _WS.sub(" ", space_separators(s, spaced_separators)).strip()
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


PLURAL_ZERO = frozenset({"I", "l", "|", "i", "!", "1", "U", "u", "O", "o", "D", "Q", "0"})
_FINISH_WORD = re.compile(r"[ft]?[il1|]?n[il1|]?s[hn][a-z]*|[ft][il1|]n[a-z]*", re.IGNORECASE)


def parse_finishes(raw: str, max_kills: int = 99) -> int | None:
    """ "5 finishes" / "1 finish" / OCR variants ("Ofinishes", "l finish", "I inish", "1I fnish") -> int.

    The game writes the singular only for exactly one finish, so a singular word means 1 whatever digit
    was read; otherwise the token before the word is the number (digit lookalikes mapped)."""
    s = nfc(raw).strip()
    word = _FINISH_WORD.search(s)
    if word:
        w = word.group(0).lower()
        if w.endswith("h"):  # "finish" (also "fnish", "inish"); "finishe(s)" / "finisshes" are plural
            return 1
        head = s[: word.start()]
        token = "".join(head.split())
        # plural: the number is not 1. The narrow "0" glyph is the one the recogniser drops or reads as
        # I / l / U (measured on 1884 labelled strips: every such plural reading was 0)
        if not token or token in PLURAL_ZERO:
            return 0
    else:
        token = "".join(s.split())
    if not token or len(token) > 2:
        return None
    if len(token) == 2 and any(c.isdigit() for c in token) and not token.isdigit():
        token = "".join(c for c in token if c.isdigit())  # "B6" -> 6: a stray lookalike beside a real digit
    digits = "".join(DIGIT_LOOKALIKES.get(c, c) for c in token)
    if not digits.isdigit():
        return None
    v = int(digits)
    return v if 0 <= v <= max_kills else None


def finishes_digit_read(raw: str) -> bool:
    """False when the number had to be implied by the wording (no digit-like token before the word)."""
    word = _FINISH_WORD.search(nfc(raw))
    head = nfc(raw)[: word.start()] if word else nfc(raw)
    return bool("".join(head.split()))


def finishes_consistent(raw: str, value: int) -> bool:
    """'finish' (singular) must go with 1, 'finishes' with anything else. Used to adjust confidence."""
    s = nfc(raw).lower()
    if "finishes" in s:
        return value != 1
    if "finish" in s:
        return value == 1
    return True
