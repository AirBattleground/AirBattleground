from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from app.bundle import ModelBundle, active_bundle, set_registry
from app.training.registry import FileRegistry, VersionNotFound, VersionNotReady


def test_base_version_created(models_dir: Path) -> None:
    reg = FileRegistry()
    assert reg.versions() == ["v0"]
    assert reg.active_version() == "v0"
    b = reg.active()
    assert b.version == "v0" and b.rec_model_dir is None and b.lexicon == ()
    assert reg.get("base").version == "v0"
    lst = reg.list_models()
    assert lst.active == "v0" and lst.items[0].trainer == "stock" and lst.items[0].active


def test_create_finalize_activate_and_rollback(models_dir: Path) -> None:
    reg = FileRegistry()
    d = reg.create_version("v0", "adaptive", sample_count=3)
    assert d.version == "v1" and reg.manifest("v1")["parent"] == "v0"
    assert reg.manifest("v1")["status"] == "training"
    with pytest.raises(VersionNotReady):
        reg.activate("v1")
    d.write_lexicon(["B", "A", "A"])
    d.write_char_fixes({"0->O": {"context": "letters"}})
    reg.finalize(d, trainer="adaptive", sample_count=3, metrics=None, notes="n")
    assert reg.manifest("v1")["artifacts"] == {"lexicon": "lexicon.json", "char_fixes": "char_fixes.json"}
    reg.activate("v1")
    assert reg.active().lexicon == ("A", "B")
    assert reg.active().char_fixes == {"0->O": {"context": "letters"}}
    # rollback
    reg.activate("v0")
    assert reg.active().version == "v0"
    assert json.loads((models_dir / "active.json").read_text())["previous"] == "v1"


def test_version_numbers_never_collide(models_dir: Path) -> None:
    reg = FileRegistry()
    a = reg.create_version("v0", "adaptive")
    reg.mark_failed(a.version, "boom")
    b = reg.create_version("v0", "adaptive")
    assert (a.version, b.version) == ("v1", "v2")
    assert reg.info("v1").status == "failed"
    with pytest.raises(VersionNotReady):
        reg.activate("v1")


def test_activate_is_atomic(models_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    reg = FileRegistry()
    d = reg.create_version("v0", "adaptive")
    reg.finalize(d, trainer="adaptive", sample_count=0, metrics=None, notes=None)

    def boom(*a: object, **k: object) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", boom)
    with pytest.raises(OSError):
        reg.activate("v1")
    monkeypatch.undo()
    assert reg.active_version() == "v0"
    assert json.loads((models_dir / "active.json").read_text())["version"] == "v0"
    assert not [p for p in models_dir.iterdir() if p.name.endswith(".tmp")]


def test_corrupt_pointer_falls_back_to_base(models_dir: Path) -> None:
    reg = FileRegistry()
    (models_dir / "active.json").write_text("{not json")
    assert reg.active().version == "v0"
    (models_dir / "active.json").write_text('{"version": "v9"}')
    assert reg.active_version() == "v0"


def test_unknown_or_malicious_version(models_dir: Path) -> None:
    reg = FileRegistry()
    for v in ("v7", "../etc", "v1/../../x"):
        with pytest.raises(VersionNotFound):
            reg.get(v)


def test_override_and_bundle_seam(models_dir: Path) -> None:
    reg = FileRegistry()
    set_registry(reg)
    assert active_bundle().version == "v0"
    with reg.override(ModelBundle(version="candidate", lexicon=("x",))):
        assert active_bundle().version == "candidate"
    assert active_bundle().version == "v0"


def test_active_cache_tracks_pointer_changes(models_dir: Path) -> None:
    a, b = FileRegistry(), FileRegistry()  # e.g. two worker processes
    d = a.create_version("v0", "adaptive")
    a.finalize(d, trainer="adaptive", sample_count=0, metrics=None, notes=None)
    assert b.active_version() == "v0"
    a.activate("v1")
    assert b.active_version() == "v1"
