"""Synthetic BGMI screenshot generator (SLOT_LIST lobby cards + RESULTS panels).

FOR TESTS AND PIPELINE DEVELOPMENT ONLY. Accuracy measured on these images is *synthetic* accuracy and must
never be reported as real accuracy (labels.json carries `"synthetic": true` and run_eval marks it).

Geometry is measured from the real 1600x720 (20:9) samples in eval/dataset/real/. Other aspect ratios
(16:9) are produced by scaling the 20:9 design by height/width and centring it (an approximation: we have no
real 16:9 sample yet). Fonts: Noto Sans / DejaVu Bold squeezed horizontally to imitate the condensed game
font, with per-character fallback to Noto CJK and Noto Devanagari when installed (found via fc-list).

    uv run python -m synth.generate --matches 4 --out eval/dataset/synthetic --seed 7
"""

from __future__ import annotations

import argparse
import json
import random
import subprocess
from dataclasses import dataclass, field
from functools import cache, lru_cache
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFilter, ImageFont

REF_W, REF_H = 1600, 720
SERVICE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_OUT = SERVICE_DIR / "eval" / "dataset" / "synthetic"
ASPECTS = {"20:9": (1600, 720), "16:9": (1280, 720), "16:9-hd": (1920, 1080)}

# ---------------------------------------------------------------- fonts
_FONT_PATTERNS = {
    "latin": ["NotoSans-Bold.ttf", "DejaVuSansCondensed-Bold.ttf", "DejaVuSans-Bold.ttf"],
    "fallback": [
        "DejaVuSans-Bold.ttf",
        "NotoSansSymbols-Bold.ttf",
        "NotoSansSymbols2-Regular.ttf",
        "NotoSansMath-Regular.ttf",
    ],
    "cjk": ["NotoSansCJK-Bold.ttc", "NotoSansCJK-Regular.ttc", "NotoSerifCJK-Bold.ttc"],
    "deva": ["NotoSansDevanagari-Bold.ttf", "NotoSansDevanagari-Regular.ttf"],
}


@lru_cache(maxsize=1)
def _fc_files() -> list[str]:
    try:
        out = subprocess.run(["fc-list", ":", "file"], capture_output=True, text=True, timeout=20).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    return [line.split(":")[0].strip() for line in out.splitlines() if line.strip()]


@cache
def font_files(group: str) -> tuple[str, ...]:
    files = _fc_files()
    found = []
    for pat in _FONT_PATTERNS[group]:
        found += [f for f in files if f.endswith("/" + pat)]
    return tuple(found)


@cache
def _font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def _render_mask(f: ImageFont.FreeTypeFont, c: str) -> bytes:
    im = Image.new("L", (int(f.size * 3), int(f.size * 2)))
    ImageDraw.Draw(im).text((2, 2), c, font=f, fill=255)
    return im.tobytes()


@cache
def has_glyph(path: str, c: str) -> bool:
    f = _font(path, 24)
    return _render_mask(f, c) != _render_mask(f, chr(0x10FFFD))


def font_for_char(c: str) -> str | None:
    cp = ord(c)
    groups = ["latin", "fallback"]
    if 0x0900 <= cp <= 0x097F:
        groups = ["deva"] + groups
    elif cp >= 0x2E80:
        groups = ["cjk"] + groups
    for g in groups:
        for p in font_files(g):
            if has_glyph(p, c):
                return p
    return None


def can_render(text: str) -> bool:
    return all(c == " " or font_for_char(c) for c in text)


def _runs(text: str) -> list[tuple[str, str]]:
    runs: list[tuple[str, str]] = []
    for c in text:
        p = font_for_char(c) if c != " " else (runs[-1][0] if runs else font_files("latin")[0])
        p = p or font_files("latin")[0]
        # Devanagari combining marks must stay in the same run for shaping
        if runs and (
            runs[-1][0] == p or (c != " " and 0x0900 <= ord(c) <= 0x097F and "deva" in runs[-1][0].lower())
        ):
            runs[-1] = (runs[-1][0], runs[-1][1] + c)
        else:
            runs.append((p, c))
    return runs


def render_text(text: str, height: int, color: tuple[int, int, int], squeeze: float = 0.72) -> Image.Image:
    """RGBA image of `text` with cap-height ≈ `height`, condensed horizontally by `squeeze`."""
    size = max(8, int(height * 1.38))
    pieces = []
    for path, chunk in _runs(text):
        f = _font(path, size)
        _, _, r, _ = f.getbbox(chunk)
        im = Image.new("L", (max(1, int(r)) + 4, size * 2), 0)
        ImageDraw.Draw(im).text((0, size // 3), chunk, font=f, fill=255)
        pieces.append(im)
    w = sum(p.width for p in pieces)
    mask = Image.new("L", (max(1, w), size * 2), 0)
    x = 0
    for p in pieces:
        mask.paste(p, (x, 0))
        x += p.width
    bbox = mask.getbbox()
    if bbox:
        mask = mask.crop((bbox[0], 0, bbox[2], mask.height))
    mask = mask.resize((max(1, int(mask.width * squeeze)), mask.height), Image.Resampling.LANCZOS)
    out = Image.new("RGBA", mask.size, (*color, 0))
    out.putalpha(mask)
    return out


def _paste_text(
    img: Image.Image,
    text: str,
    xy: tuple[float, float],
    height: int,
    color: tuple[int, int, int],
    anchor: str = "lm",
    squeeze: float = 0.72,
) -> int:
    t = render_text(text, height, color, squeeze)
    bb = t.getbbox() or (0, 0, t.width, t.height)
    t = t.crop((0, bb[1], t.width, bb[3]))
    x, y = xy
    if anchor[0] == "r":
        x -= t.width
    elif anchor[0] == "m":
        x -= t.width / 2
    y -= t.height / 2 if anchor[1] == "m" else 0
    img.alpha_composite(t, (int(x), int(y)))
    return int(t.width)


# ---------------------------------------------------------------- names
_CLAN = [
    "GE",
    "A9",
    "AE",
    "7S",
    "EMP",
    "TH",
    "AI",
    "THUG",
    "WRG",
    "4TR",
    "SYM",
    "IM",
    "TF",
    "9T",
    "EE",
    "TAP",
    "ZAROO",
    "OP",
    "K9",
    "RVN",
    "HYD",
    "XO",
    "1ST",
    "S8UL",
    "GOD",
    "TX",
]
_SEP = ["x", "x", "x", " | ", " · ", "多", "シ", " ", "x"]
_WORDS = [
    "Ruwad",
    "MoOnGOD",
    "FireGod",
    "DeadPlaYeR",
    "Stanzo",
    "Jenu",
    "Gujjar",
    "Blaziken",
    "VENOM",
    "TARUN",
    "Rolf",
    "GHOST",
    "TIGER",
    "CHILLY",
    "Kenn",
    "Ilk",
    "SLIce",
    "FRAGGER",
    "MURDER",
    "TenDor",
    "SLAYER",
    "Titann",
    "KratoS",
    "Cloud",
    "gawd",
    "GobliN",
    "TANUUU",
    "JATIN",
    "ANGAT",
    "ishu",
    "JONATHAN",
    "ARJUN",
    "GOJO",
    "SKULL",
    "SONU",
    "Sagar",
    "goku",
    "Livik",
    "KARTIK",
    "CASH",
    "Baki",
    "Jod",
    "VAIBHAV",
    "LUCIFER",
    "jumpeR",
    "Stish",
    "TIXZO",
    "KrAg",
    "ZeD",
    "Flexy",
    "Franky",
    "Broly",
    "ARI",
    "Mortal",
    "Scout",
    "Talent",
    "Papa",
    "Rexxy",
    "Munawar",
    "Ladle",
    "Lattu",
    "Muttaya",
    "DROXXI",
    "GAMING",
    "Viper",
    "Zyro",
    "Hydra",
    "Owais",
]
_UNICODE_SWAPS = {"A": "Ā", "O": "Ø", "U": "Û", "E": "Ē", "S": "Ś", "I": "Ī"}
_UPSIDE = {"k": "ʞ", "m": "ɯ", "r": "ɹ", "a": "ɐ", "e": "ǝ", "h": "ɥ", "t": "ʇ", "y": "ʎ"}
_DEVA = ["आशीष्", "राहुल", "अमन", "विक्रम", "सूरज", "रवि"]
_LOOKALIKE = {"I": ["l", "1"], "l": ["I", "1"], "O": ["0"], "o": ["0"], "1": ["I", "l"], "0": ["O"]}


def _case(w: str, rng: random.Random) -> str:
    r = rng.random()
    if r < 0.3:
        return w.upper()
    if r < 0.45:
        return "".join(c.upper() if rng.random() < 0.4 else c.lower() for c in w)
    return w


def random_name(rng: random.Random) -> str:
    r = rng.random()
    if r < 0.05:
        return rng.choice(_DEVA)
    if r < 0.09:
        w = rng.choice(_WORDS).lower()
        return "".join(_UPSIDE.get(c, c) for c in w)[::-1][:10] + str(rng.randint(0, 9))
    name = ""
    if rng.random() < 0.7:
        name = rng.choice(_CLAN) + rng.choice(_SEP)
    name += _case(rng.choice(_WORDS), rng)
    if rng.random() < 0.3:
        name += _case(rng.choice(_WORDS), rng)
    if rng.random() < 0.3:
        name += str(rng.randint(0, 999))
    # lookalikes I/l/1, O/0
    chars = list(name)
    for i, c in enumerate(chars):
        if c in _LOOKALIKE and rng.random() < 0.25:
            chars[i] = rng.choice(_LOOKALIKE[c])
    name = "".join(chars)
    if rng.random() < 0.08:
        name = "".join(_UNICODE_SWAPS.get(c, c) if rng.random() < 0.5 else c for c in name)
    if rng.random() < 0.04:
        name = f"《{name[:9]}£》"
    if rng.random() < 0.03:
        name = f"· {name[:10]} ·"
    name = " ".join(name.split())[:15].strip()
    return name if can_render(name) else "".join(c for c in name if c.isascii()) or "Player"


# ---------------------------------------------------------------- match model
@dataclass
class Team:
    slot: int
    players: list[str]
    kills: list[int] = field(default_factory=list)


def random_match(rng: random.Random) -> list[Team]:
    first = rng.choice([1, 3, 5])
    n = rng.randint(12, 22)
    slots = sorted(rng.sample(range(first, first + 25), n))
    used: set[str] = set()
    teams = []
    for s in slots:
        size = 4 if rng.random() < 0.88 else 3
        players: list[str] = []
        while len(players) < size:
            nm = random_name(rng)
            if nm not in used:
                used.add(nm)
                players.append(nm)
        kills = [min(15, int(rng.expovariate(0.6))) for _ in players]
        teams.append(Team(s, players, kills))
    return teams


# ---------------------------------------------------------------- drawing helpers
SLOT_COLORS = [
    (124, 58, 237),
    (225, 52, 56),
    (110, 170, 30),
    (226, 54, 120),
    (230, 150, 20),
    (240, 200, 40),
    (40, 190, 190),
    (140, 160, 190),
    (235, 120, 30),
]


def _background(rng: random.Random, dark: int) -> Image.Image:
    small = Image.new("RGB", (64, 29), (dark, dark, dark + 4))
    d = ImageDraw.Draw(small)
    for _ in range(25):
        x, y = rng.randint(0, 63), rng.randint(0, 28)
        v = dark + rng.randint(0, 30)
        tint = rng.randint(-6, 6)
        d.ellipse((x - 6, y - 4, x + 6, y + 4), fill=(v + tint, v, v - tint))
    big = small.filter(ImageFilter.GaussianBlur(2)).resize((REF_W, REF_H), Image.Resampling.BICUBIC)
    return big.filter(ImageFilter.GaussianBlur(8)).convert("RGBA")


def _finish_text(k: int) -> str:
    return "1 finish" if k == 1 else f"{k} finishes"


def draw_slot_list(teams: list[Team], rng: random.Random, remaining: int, total_teams: int) -> Image.Image:
    img = _background(rng, 30)
    ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    xs, ys = [185, 573, 960], [87, 292, 498]
    cw, ch = 363, 187
    for i, _t in enumerate(teams):
        x0, y0 = xs[i % 3], ys[i // 3]
        d.rectangle((x0, y0, x0 + cw, y0 + ch), fill=(13, 15, 20, 238))
    img.alpha_composite(ov)
    x = 185
    for txt, hgt, gap in (
        ("Remaining", 26, 12),
        (str(remaining), 34, 30),
        ("Team", 26, 12),
        (str(total_teams), 34, 0),
    ):
        x += _paste_text(img, txt, (x, 65), hgt, (240, 240, 240), "lm", 0.75) + gap
    _paste_text(img, "X", (1390, 62), 34, (240, 240, 240), "mm", 1.2)
    for i, t in enumerate(teams):
        x0, y0 = xs[i % 3], ys[i // 3]
        _paste_text(img, f"{t.slot:02d}", (x0 + 17, y0 + 30), 30, rng.choice(SLOT_COLORS), "lm", 0.62)
        for j, nm in enumerate(t.players):
            y = y0 + 29 + j * 42.6
            _paste_text(img, nm, (x0 + 57, y), 15, (240, 240, 240), "lm")
            _paste_text(img, "/0", (x0 + 267, y), 15, (235, 235, 235), "lm", 0.8)
            _paste_text(img, "Eliminations", (x0 + 291, y), 12, (165, 165, 170), "lm", 0.72)
    return img


def _wings(img: Image.Image, cx: int, cy: int) -> None:
    d = ImageDraw.Draw(img)
    gold = (200, 160, 70, 255)
    for s in (-1, 1):
        d.polygon(
            [
                (cx, cy - 5),
                (cx + s * 34, cy - 18),
                (cx + s * 30, cy - 4),
                (cx + s * 22, cy + 8),
                (cx, cy + 6),
            ],
            fill=gold,
        )
    d.ellipse(
        (cx - 13, cy - 16, cx + 13, cy + 18), fill=(150, 115, 45, 255), outline=(235, 200, 110, 255), width=2
    )
    d.polygon([(cx - 10, cy - 18), (cx, cy - 30), (cx + 10, cy - 18)], fill=gold)


def draw_results(
    rows: list[tuple[int, Team]], pinned: list[Team], rng: random.Random, first: int = 0
) -> tuple[Image.Image, list[int]]:
    """rows = all (rank, team) of the scrolling right panel (rank 3..N); the panel is scrolled so block
    `first` is near the top (sometimes cut). Returns the indices of fully visible (labelled) blocks."""
    img = _background(rng, 10)
    d = ImageDraw.Draw(img)
    # left panel: rank 1 (gold border, wings, no digit) and rank 2
    d.rectangle((212, 132, 820, 345), fill=(30, 25, 16, 255), outline=(150, 115, 45, 255), width=2)
    d.rectangle((212, 346, 820, 562), fill=(14, 14, 15, 255))
    _wings(img, 253, 237)
    _paste_text(img, "2", (253, 456), 26, (245, 245, 245), "mm", 0.8)
    for top, team in ((177, pinned[0]), (396, pinned[1])):
        for j, nm in enumerate(team.players):
            y = top + j * 40
            _paste_text(img, nm, (343, y), 17, (240, 240, 240), "lm")
            _paste_text(img, _finish_text(team.kills[j]), (788, y), 16, (225, 225, 225), "rm", 0.72)
    # right panel (scrolling window y in [131, 628])
    top0 = 131 - first * 165 + (rng.choice([0, 0, 2, -12, -40, -100]) if first else 0)
    win_top, win_bot = 131, 628
    labelled = []
    panel = Image.new("RGBA", img.size, (0, 0, 0, 0))
    for k, (rank, team) in enumerate(rows):
        bt = top0 + k * 165
        bb = bt + 160
        if bt > win_bot:
            break
        if bb < win_top:
            continue
        block = Image.new("RGBA", (542, 160), (0, 0, 0, 0))
        bd = ImageDraw.Draw(block)
        for yy in range(160):
            g = 1 - yy / 400
            bd.line((0, yy, 542, yy), fill=(int(150 * g), int(118 * g), int(38 * g), 255))
        for xx in range(-160, 542, 14):
            bd.line((xx, 160, xx + 160, 0), fill=(165, 132, 48, 60), width=4)
        bd.rectangle((0, 0, 7, 160), fill=(235, 195, 45, 255))
        _paste_text(block, str(rank), (44, 82), 32, (250, 250, 250), "mm", 0.7)
        for j, nm in enumerate(team.players):
            y = 12 + j * 40
            _paste_text(block, nm, (119, y), 15, (245, 245, 245), "lm")
            _paste_text(block, _finish_text(team.kills[j]), (508, y + 7), 13, (235, 230, 215), "rm", 0.72)
        cut_top = max(0, win_top - bt)
        cut_bot = min(160, win_bot - bt)
        if cut_bot <= cut_top:
            continue
        panel.alpha_composite(block.crop((0, cut_top, 542, cut_bot)), (838, bt + cut_top))
        if bt >= win_top and bb <= win_bot:
            labelled.append(k)
    img.alpha_composite(panel)
    d = ImageDraw.Draw(img)
    d.rectangle((1410, 645, 1571, 700), outline=(220, 220, 220, 255), width=2, fill=(8, 8, 8, 255))
    _paste_text(img, "Continue", (1490, 673), 16, (240, 240, 240), "mm", 0.8)
    return img, labelled


def to_aspect(img: Image.Image, aspect: str) -> Image.Image:
    w, h = ASPECTS[aspect]
    if (w, h) == (REF_W, REF_H):
        return img.convert("RGB")
    s = min(w / REF_W, h / REF_H)
    scaled = img.convert("RGB").resize((int(REF_W * s), int(REF_H * s)), Image.Resampling.LANCZOS)
    canvas = img.convert("RGB").resize((w, h)).filter(ImageFilter.GaussianBlur(25)).point(lambda v: v // 2)
    canvas.paste(scaled, ((w - scaled.width) // 2, (h - scaled.height) // 2))
    return canvas


# ---------------------------------------------------------------- dataset
def generate(
    out: Path,
    matches: int = 3,
    seed: int = 7,
    aspects: tuple[str, ...] = ("20:9", "16:9"),
    quality: tuple[int, int] = (70, 92),
) -> dict[str, Any]:
    rng = random.Random(seed)
    out.mkdir(parents=True, exist_ok=True)
    images: list[dict[str, Any]] = []
    for m in range(matches):
        teams = random_match(rng)
        aspect = aspects[m % len(aspects)]

        def save(img: Image.Image, name: str, aspect: str = aspect) -> str:
            fn = f"{name}.jpg"
            to_aspect(img, aspect).save(out / fn, quality=rng.randint(*quality))
            return fn

        # lobby screenshots, 9 cards each
        for li in range(0, len(teams), 9):
            chunk = teams[li : li + 9]
            img = draw_slot_list(chunk, rng, rng.randint(40, 100), len(teams))
            fn = save(img, f"m{m}-lobby-{li // 9 + 1}")
            images.append(
                {
                    "file": fn,
                    "kind": "SLOT_LIST",
                    "aspect": aspect,
                    "teams": [{"slot": t.slot, "players": t.players} for t in chunk],
                }
            )
        # results: random placement order; ranks 1-2 pinned, right panel scrolls 3 at a time from rank 3
        order = teams[:]
        rng.shuffle(order)
        ranked = list(enumerate(order, start=1))
        rows_in = ranked[2:]
        for ri, first in enumerate(range(0, len(rows_in), 3)):
            img, labelled_idx = draw_results(rows_in, [order[0], order[1]], rng, first)
            fn = save(img, f"m{m}-result-{ri + 1}")
            rows = [
                {
                    "rank": 1,
                    "players": [
                        {"name": n, "kills": k} for n, k in zip(order[0].players, order[0].kills, strict=True)
                    ],
                },
                {
                    "rank": 2,
                    "players": [
                        {"name": n, "kills": k} for n, k in zip(order[1].players, order[1].kills, strict=True)
                    ],
                },
            ]
            for k in labelled_idx:
                r, t = rows_in[k]
                rows.append(
                    {
                        "rank": r,
                        "players": [
                            {"name": n, "kills": kk} for n, kk in zip(t.players, t.kills, strict=True)
                        ],
                    }
                )
            images.append({"file": fn, "kind": "RESULTS", "aspect": aspect, "rows": rows})
    labels = {
        "_about": "SYNTHETIC screenshots generated by synth/generate.py for tests and pipeline "
        "development ONLY. "
        "Accuracy on these images is not real-world accuracy.",
        "synthetic": True,
        "seed": seed,
        "needs_human_check": [],
        "images": images,
    }
    (out / "labels.json").write_text(
        json.dumps(labels, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    return labels


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--matches", type=int, default=3)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--aspects", default="20:9,16:9", help=f"comma list of {sorted(ASPECTS)}")
    a = ap.parse_args(argv)
    labels = generate(a.out, a.matches, a.seed, tuple(x.strip() for x in a.aspects.split(",")))
    print(f"wrote {len(labels['images'])} SYNTHETIC images + labels.json to {a.out}")


if __name__ == "__main__":
    main()
