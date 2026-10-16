"""Runtime configuration (environment variables, optionally a `.env` file next to pyproject.toml)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_ROOT = Path(__file__).resolve().parent.parent  # services/extractor
REPO_ROOT = SERVICE_ROOT.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=SERVICE_ROOT / ".env", extra="ignore")

    service_version: str = "0.1.0"
    storage_dir: Path = REPO_ROOT / "storage"
    models_dir: Path = SERVICE_ROOT / "models"
    layout_path: Path = Path(__file__).resolve().parent / "config" / "layout.yaml"

    # OCR (PaddleOCR 3.x recognition-only). Model files are cached under PADDLE_PDX_CACHE_HOME
    # (default ~/.paddlex); the Docker image pre-downloads them at build time.
    ocr_rec_model: str = "PP-OCRv6_small_rec"
    ocr_rec_model_dir: Path | None = None  # explicit local model dir (overrides the name lookup)
    ocr_alt_rec_models: tuple[str, ...] = ("devanagari_PP-OCRv5_mobile_rec",)  # re-read low-confidence names
    ocr_alt_below: float = 0.75  # names scoring below this are re-read with the alt models (best score wins)
    ocr_alt_margin: float = 0.05  # an alternate reading must beat the primary score by this much
    ocr_batch_size: int = 16
    ocr_threads: int = 4

    # optional VLM fallback (Ollama); off by default
    vlm_enabled: bool = False
    ollama_url: str = "http://localhost:11434"
    vlm_model: str = "qwen2.5vl:3b"
    vlm_timeout_s: float = 30.0

    low_confidence: float = 0.85
    max_image_mb: float = 10.0
    max_batch_files: int = 40
    debug_crops: bool = False
    debug_dir: Path = SERVICE_ROOT / "debug"
    log_level: str = "INFO"
    log_json: bool = True


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
