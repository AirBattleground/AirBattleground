from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

from synth.generate import generate, random_name


def test_generates_both_layouts_and_aspects(tmp_path: Path) -> None:
    labels = generate(tmp_path, matches=2, seed=1, aspects=("20:9", "16:9"))
    assert labels["synthetic"] is True and "SYNTHETIC" in labels["_about"]
    on_disk = json.loads((tmp_path / "labels.json").read_text(encoding="utf-8"))
    assert on_disk["images"] == labels["images"]
    kinds = {i["kind"] for i in labels["images"]}
    assert kinds == {"SLOT_LIST", "RESULTS"}
    sizes = {Image.open(tmp_path / i["file"]).size for i in labels["images"]}
    assert sizes == {(1600, 720), (1280, 720)}
    for im in labels["images"]:
        if im["kind"] == "SLOT_LIST":
            assert 1 <= len(im["teams"]) <= 9
            assert all(3 <= len(t["players"]) <= 4 for t in im["teams"])
        else:
            ranks = [r["rank"] for r in im["rows"]]
            assert ranks[:2] == [1, 2] and len(ranks) <= 5
            assert all(isinstance(p["kills"], int) for r in im["rows"] for p in r["players"])


def test_names_cover_unicode_and_lookalikes() -> None:
    import random

    rng = random.Random(0)
    names = [random_name(rng) for _ in range(3000)]
    joined = "".join(names)
    assert any(c in joined for c in "0O") and any(c in joined for c in "Il1")
    assert any(ord(c) > 127 for c in joined)
    assert all(0 < len(n) <= 15 for n in names)
