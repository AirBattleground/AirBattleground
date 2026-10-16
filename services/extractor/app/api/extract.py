"""Extraction HTTP API (contract: app/schemas.py).

    GET  /healthz            -> Health
    GET  /v1/version         -> VersionInfo
    POST /v1/extract         multipart: image, kind=slot_list|results, roster (JSON string, optional)
    POST /v1/extract/batch   multipart: images[] (or a single .zip), kind, roster

Errors are JSON `{"error": {"code": "...", "message": "..."}}` with a 4xx status. Every response carries
`X-Request-ID` (the caller's, if sent).

Python callers (training / eval) should not go through HTTP — use the pure function re-exported here:

    from app.api.extract import extract_image          # == app.pipeline.orchestrator.extract_image
    extraction = extract_image(image_bytes, "results", roster)
"""

from __future__ import annotations

import io
import json
import threading
import zipfile
from typing import Annotated, Any

from fastapi import APIRouter, File, Form, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.bundle import active_bundle
from app.config import load_layout
from app.logging import configure_logging, get_logger, new_request_id
from app.pipeline.orchestrator import ImageDecodeError, extract_image, warmup
from app.schemas import BatchExtraction, Extraction, Health, Kind, Roster, VersionInfo
from app.settings import get_settings

__all__ = ["router", "extract_image", "on_startup"]

log = get_logger(__name__)
router = APIRouter()

_ocr_ready = threading.Event()
_warmup_error: list[str] = []

_IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp")


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def _error(e: ApiError, rid: str) -> JSONResponse:
    return JSONResponse(
        status_code=e.status,
        content={"error": {"code": e.code, "message": e.message}},
        headers={"X-Request-ID": rid},
    )


def _warmup() -> None:
    try:
        warmup()
        _ocr_ready.set()
        log.info("ocr_ready")
    except Exception as e:  # keep serving /healthz as degraded
        _warmup_error.append(f"{type(e).__name__}: {e}")
        log.error("ocr_warmup_failed", error=_warmup_error[-1])


def on_startup() -> None:
    s = get_settings()
    configure_logging(s.log_level, s.log_json)
    threading.Thread(target=_warmup, name="ocr-warmup", daemon=True).start()


def sniff_image_type(data: bytes) -> str | None:
    """png / jpeg / webp by magic bytes (the Content-Type header is not trusted)."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def parse_kind(kind: str | None) -> Kind:
    k = (kind or "slot_list").strip().lower()
    if k in ("slot_list", "results"):
        return k  # type: ignore[return-value]
    raise ApiError(400, "INVALID_KIND", "kind must be 'slot_list' or 'results'")


def parse_roster(raw: str | None) -> Roster | None:
    if raw is None or not raw.strip():
        return None
    try:
        return Roster.model_validate(json.loads(raw))
    except (json.JSONDecodeError, ValidationError) as e:
        raise ApiError(400, "INVALID_ROSTER", f'roster must be JSON like {{"slots": [...]}}: {e}') from e


def check_image(data: bytes, name: str) -> None:
    max_bytes = int(get_settings().max_image_mb * 1024 * 1024)
    if not data:
        raise ApiError(400, "EMPTY_FILE", f"{name} is empty")
    if len(data) > max_bytes:
        raise ApiError(413, "IMAGE_TOO_LARGE", f"{name} is larger than {get_settings().max_image_mb:g} MB")
    if sniff_image_type(data) is None:
        raise ApiError(415, "UNSUPPORTED_TYPE", f"{name} is not a PNG, JPEG or WebP image")


def _run(data: bytes, kind: Kind, roster: Roster | None, name: str) -> Extraction:
    check_image(data, name)
    try:
        return extract_image(data, kind, roster)
    except ImageDecodeError as e:
        raise ApiError(422, "UNREADABLE_IMAGE", f"{name} could not be decoded as an image") from e


@router.get("/healthz", response_model=Health)
def healthz(response: Response) -> Health:
    ready = _ocr_ready.is_set()
    response.headers["Cache-Control"] = "no-store"
    return Health(
        status="ok" if ready else "degraded", model_version=active_bundle().version, ocr_ready=ready
    )


@router.get("/v1/version", response_model=VersionInfo)
def version() -> VersionInfo:
    s = get_settings()
    layout = load_layout(s.layout_path, active_bundle().layout)
    return VersionInfo(
        service_version=s.service_version,
        model_version=active_bundle().version,
        layout_version=str(layout.get("layout_version", "unknown")),
        vlm_enabled=s.vlm_enabled,
    )


@router.post("/v1/extract", response_model=Extraction)
def extract(
    request: Request,
    response: Response,
    image: Annotated[UploadFile | None, File()] = None,
    kind: Annotated[str | None, Form()] = None,
    roster: Annotated[str | None, Form()] = None,
) -> Any:
    rid = new_request_id(request.headers.get("x-request-id"))
    response.headers["X-Request-ID"] = rid
    try:
        if image is None:
            raise ApiError(400, "MISSING_IMAGE", "send the screenshot as multipart field 'image'")
        k = parse_kind(kind)
        r = parse_roster(roster)
        data = image.file.read(int(get_settings().max_image_mb * 1024 * 1024) + 1)
        return _run(data, k, r, image.filename or "image")
    except ApiError as e:
        log.info("extract_rejected", code=e.code, message=e.message)
        return _error(e, rid)


def _zip_members(data: bytes) -> list[tuple[str, bytes | None]]:
    s = get_settings()
    max_bytes = int(s.max_image_mb * 1024 * 1024)
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise ApiError(400, "INVALID_ZIP", "the archive is not a valid .zip file") from e
    out: list[tuple[str, bytes | None]] = []
    with zf:
        infos = [
            i
            for i in zf.infolist()
            if not i.is_dir()
            and i.filename.lower().endswith(_IMAGE_EXT)
            and not i.filename.split("/")[-1].startswith(".")
        ]
        if len(infos) > s.max_batch_files:
            raise ApiError(413, "TOO_MANY_FILES", f"at most {s.max_batch_files} images per batch")
        for info in sorted(infos, key=lambda i: i.filename):
            if info.file_size > max_bytes:
                out.append((info.filename, None))  # reported as too large without inflating it
                continue
            out.append((info.filename, zf.read(info)))
    if not out:
        raise ApiError(400, "EMPTY_ZIP", "the archive contains no PNG, JPEG or WebP images")
    return out


@router.post("/v1/extract/batch", response_model=BatchExtraction)
def extract_batch(
    request: Request,
    response: Response,
    images: Annotated[list[UploadFile] | None, File()] = None,
    kind: Annotated[str | None, Form()] = None,
    roster: Annotated[str | None, Form()] = None,
) -> Any:
    rid = new_request_id(request.headers.get("x-request-id"))
    response.headers["X-Request-ID"] = rid
    s = get_settings()
    try:
        if not images:
            raise ApiError(
                400, "MISSING_IMAGES", "send screenshots as multipart field 'images' (or one .zip)"
            )
        k = parse_kind(kind)
        r = parse_roster(roster)
        files: list[tuple[str, bytes | None]] = []
        zip_limit = int(s.max_image_mb * 1024 * 1024) * s.max_batch_files
        for up in images:
            name = up.filename or "image"
            if name.lower().endswith(".zip") or (up.content_type or "").endswith("zip"):
                files.extend(_zip_members(up.file.read(zip_limit + 1)))
            else:
                files.append((name, up.file.read(int(s.max_image_mb * 1024 * 1024) + 1)))
        if len(files) > s.max_batch_files:
            raise ApiError(413, "TOO_MANY_FILES", f"at most {s.max_batch_files} images per batch")
    except ApiError as e:
        return _error(e, rid)
    items: list[Extraction] = []
    errors: list[dict[str, str]] = []
    for name, data in files:
        try:
            if data is None:
                raise ApiError(413, "IMAGE_TOO_LARGE", f"{name} is larger than {s.max_image_mb:g} MB")
            items.append(_run(data, k, r, name))
        except ApiError as e:
            errors.append({"file": name, "code": e.code, "message": e.message})
        except Exception as e:  # one bad image must not fail the batch
            log.exception("batch_item_failed", file=name)
            errors.append({"file": name, "code": "EXTRACTION_FAILED", "message": f"{type(e).__name__}"})
    return BatchExtraction(items=items, errors=errors)
