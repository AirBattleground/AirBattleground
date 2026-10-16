from __future__ import annotations

import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

REAL = ROOT / "eval" / "dataset" / "real"


@pytest.fixture()
def models_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    d = tmp_path / "models"
    monkeypatch.setenv("MODELS_DIR", str(d))
    return d


@pytest.fixture(scope="session")
def synth_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    from synth.generate import generate

    d = tmp_path_factory.mktemp("synth")
    generate(d, matches=1, seed=3, aspects=("20:9",))
    return d


@pytest.fixture()
def storage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, synth_dir: Path) -> Path:
    d = tmp_path / "storage"
    (d / "samples").mkdir(parents=True)
    shutil.copytree(synth_dir, d / "samples" / "synth")
    monkeypatch.setenv("STORAGE_DIR", str(d))
    return d


@pytest.fixture(autouse=True)
def _reset_globals() -> object:
    yield
    from app.bundle import set_registry
    from app.training import evaluate, runs

    evaluate.set_extract_fn(None)
    runs.reset_manager()
    set_registry(None)  # type: ignore[arg-type]


def pytest_configure(config: pytest.Config) -> None:
    # pipeline integration tests that load PaddleOCR and read the real screenshots (`-m "not slow"` skips)
    config.addinivalue_line("markers", "slow: runs the full OCR pipeline on real screenshots")
