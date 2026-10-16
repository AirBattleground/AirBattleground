"""HTTP contract of /healthz, /v1/version, /v1/extract, /v1/extract/batch (OCR stubbed out)."""

from __future__ import annotations

import io
import json
import zipfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import extract as api
from app.schemas import BatchExtraction, Extraction, Health, Kind, Roster, TeamOut, VersionInfo

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x00" * 64


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    calls: list[tuple[str, Roster | None]] = []

    def fake(data: bytes, kind: Kind, roster: Roster | None = None) -> Extraction:
        calls.append((kind, roster))
        return Extraction(
            image_id="abc",
            kind=kind,
            model_version="base",
            needs_review=False,
            teams=[TeamOut(slot=5, slot_confidence=1.0, players=[])] if kind == "slot_list" else [],
        )

    monkeypatch.setattr(api, "extract_image", fake)
    app = FastAPI()
    app.include_router(api.router)
    c = TestClient(app)
    c.calls = calls  # type: ignore[attr-defined]
    return c


def test_health_and_version(client: TestClient) -> None:
    h = Health.model_validate(client.get("/healthz").json())
    assert h.status in ("ok", "degraded")
    v = VersionInfo.model_validate(client.get("/v1/version").json())
    assert v.layout_version and v.vlm_enabled is False


@pytest.mark.parametrize("payload", [PNG, JPEG, WEBP])
def test_extract_accepts_image_types(client: TestClient, payload: bytes) -> None:
    r = client.post("/v1/extract", files={"image": ("s.bin", payload)}, data={"kind": "slot_list"})
    assert r.status_code == 200, r.text
    ex = Extraction.model_validate(r.json())
    assert ex.kind == "slot_list" and ex.teams[0].slot == 5
    assert r.headers["x-request-id"]


def test_extract_passes_roster_and_request_id(client: TestClient) -> None:
    roster = {"slots": [{"slot": 7, "players": ["GExFireGod"]}]}
    r = client.post(
        "/v1/extract",
        files={"image": ("s.png", PNG)},
        data={"kind": "results", "roster": json.dumps(roster)},
        headers={"X-Request-ID": "req-123"},
    )
    assert r.status_code == 200
    assert r.headers["x-request-id"] == "req-123"
    kind, sent = client.calls[-1]  # type: ignore[attr-defined]
    assert kind == "results" and sent is not None and sent.slots[0].players == ["GExFireGod"]


@pytest.mark.parametrize(
    ("files", "data", "status", "code"),
    [
        ({}, {}, 400, "MISSING_IMAGE"),
        ({"image": ("a.txt", b"hello world")}, {}, 415, "UNSUPPORTED_TYPE"),
        ({"image": ("a.png", b"")}, {}, 400, "EMPTY_FILE"),
        ({"image": ("a.png", PNG)}, {"kind": "bogus"}, 400, "INVALID_KIND"),
        ({"image": ("a.png", PNG)}, {"roster": "{nope"}, 400, "INVALID_ROSTER"),
        ({"image": ("a.png", PNG)}, {"roster": '{"slots": [{"players": []}]}'}, 400, "INVALID_ROSTER"),
    ],
)
def test_extract_errors(client: TestClient, files: dict, data: dict, status: int, code: str) -> None:
    r = client.post("/v1/extract", files=files or None, data=data)
    assert r.status_code == status, r.text
    assert r.json()["error"]["code"] == code
    assert r.json()["error"]["message"]


def test_extract_too_large(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    s = api.get_settings()
    monkeypatch.setattr(s, "max_image_mb", 0.0001)
    r = client.post("/v1/extract", files={"image": ("a.png", PNG + b"\x00" * 500)})
    assert r.status_code == 413 and r.json()["error"]["code"] == "IMAGE_TOO_LARGE"


def test_batch_files_and_errors(client: TestClient) -> None:
    r = client.post(
        "/v1/extract/batch",
        files=[("images", ("a.png", PNG)), ("images", ("b.jpg", JPEG)), ("images", ("c.txt", b"nope"))],
        data={"kind": "slot_list"},
    )
    assert r.status_code == 200
    b = BatchExtraction.model_validate(r.json())
    assert len(b.items) == 2
    assert b.errors == [
        {"file": "c.txt", "code": "UNSUPPORTED_TYPE", "message": "c.txt is not a PNG, JPEG or WebP image"}
    ]


def test_batch_zip(client: TestClient) -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("shots/a.png", PNG)
        z.writestr("shots/b.webp", WEBP)
        z.writestr("labels.json", "{}")
        z.writestr("__MACOSX/._a.png", b"junk")
    r = client.post(
        "/v1/extract/batch",
        files={"images": ("s.zip", buf.getvalue(), "application/zip")},
        data={"kind": "results"},
    )
    assert r.status_code == 200, r.text
    b = BatchExtraction.model_validate(r.json())
    assert len(b.items) == 2 and not b.errors


def test_batch_bad_zip_and_missing(client: TestClient) -> None:
    r = client.post("/v1/extract/batch", files={"images": ("s.zip", b"PK-not-a-zip", "application/zip")})
    assert r.status_code == 400 and r.json()["error"]["code"] == "INVALID_ZIP"
    r = client.post("/v1/extract/batch", data={"kind": "results"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "MISSING_IMAGES"


def test_sniff() -> None:
    assert api.sniff_image_type(PNG) == "png"
    assert api.sniff_image_type(JPEG) == "jpeg"
    assert api.sniff_image_type(WEBP) == "webp"
    assert api.sniff_image_type(b"GIF89a") is None
