from __future__ import annotations

import time
from pathlib import Path

from fake_pipeline import FakePipeline
from fastapi.testclient import TestClient

from app.training import evaluate
from app.training.samples import load_dataset


def _client() -> TestClient:
    from app.main import create_app

    return TestClient(create_app())


def _refs(storage: Path) -> list[dict]:
    out = []
    for i, s in enumerate(load_dataset(storage / "samples" / "synth")):
        out.append(
            {
                "id": f"synth-{s.id}",
                "kind": s.kind,
                "image_path": f"samples/synth/{s.image_path.name}",
                "labels": s.labels,
                "split": "test" if i % 3 == 2 else "train",
            }
        )
    return out


def test_models_runs_evaluate_flow(models_dir: Path, storage: Path) -> None:
    evaluate.set_extract_fn(FakePipeline(load_dataset(storage / "samples" / "synth"), snap=False))
    with _client() as c:
        r = c.get("/v1/models")
        assert r.status_code == 200 and r.json()["active"] == "v0"

        refs = _refs(storage)
        r = c.post("/v1/evaluate", json={"samples": refs})
        assert r.status_code == 200, r.text
        base = r.json()
        assert base["split"] == "test" and base["names"] > 0

        r = c.post("/v1/training/runs", json={"samples": refs, "auto_activate": True, "notes": "t"})
        assert r.status_code == 202, r.text
        rid = r.json()["id"]
        assert r.json()["status"] == "queued" and r.json()["base_version"] == "v0"
        info = r.json()
        for _ in range(300):
            info = c.get(f"/v1/training/runs/{rid}").json()
            if info["status"] in ("succeeded", "failed"):
                break
            time.sleep(0.05)
        assert info["status"] == "succeeded", info
        assert info["result_version"] == "v1" and info["progress"] == 1.0
        assert info["metrics_before"]["name_exact"] <= info["metrics_after"]["name_exact"]
        assert info["log_tail"]
        assert [x["id"] for x in c.get("/v1/training/runs").json()] == [rid]

        models = c.get("/v1/models").json()
        v1 = next(m for m in models["items"] if m["version"] == "v1")
        assert v1["parent"] == "v0" and v1["status"] == "ready" and v1["metrics"]
        # synthetic samples (id prefix synth-) never enter the shipped lexicon
        assert (
            not (models_dir / "v1" / "lexicon.json").exists()
            or (models_dir / "v1" / "lexicon.json").read_text() == "[]\n"
        )

        r = c.post("/v1/models/v0/activate")
        assert r.status_code == 200 and r.json()["active"] == "v0"
        assert c.post("/v1/models/v9/activate").status_code == 404
        assert c.get("/v1/training/runs/nope").status_code == 404

    # history survives a restart
    from app.training import runs

    runs.reset_manager()
    with _client() as c:
        assert c.get(f"/v1/training/runs/{rid}").json()["status"] == "succeeded"


def test_rejects_paths_escaping_storage(models_dir: Path, storage: Path) -> None:
    bad = {"id": "x", "kind": "slot_list", "labels": {"teams": []}, "split": "test"}
    with _client() as c:
        for p in ("../secret.jpg", "/etc/passwd", "samples/../../x.jpg", "samples/missing.jpg"):
            r = c.post("/v1/training/runs", json={"samples": [{**bad, "image_path": p}]})
            assert r.status_code == 400, (p, r.text)
            r = c.post("/v1/evaluate", json={"samples": [{**bad, "image_path": p}]})
            assert r.status_code == 400, (p, r.text)
        assert c.post("/v1/training/runs", json={"samples": []}).status_code == 400
