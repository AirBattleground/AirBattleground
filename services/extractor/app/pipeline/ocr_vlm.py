"""Optional VLM fallback (Ollama, e.g. Qwen2.5-VL) for low-confidence name strips. Off by default
(VLM_ENABLED=false); the pipeline never depends on it. Strict JSON prompt, timeout, one retry."""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass

import cv2
import httpx

from app.logging import get_logger
from app.pipeline.detect import Image

log = get_logger(__name__)

PROMPT = (
    "The image is one cropped line of a mobile game screen showing exactly one player name. "
    "Transcribe the name exactly as drawn, preserving case, digits, spaces, symbols and any non-Latin "
    "characters. Do not guess, translate or add anything. "
    'Reply with JSON only: {"text": "<name>", "confidence": <0..1>}'
)


@dataclass(frozen=True)
class VlmResult:
    text: str
    score: float


class VlmClient:
    def __init__(self, url: str, model: str, timeout_s: float) -> None:
        self.url = url.rstrip("/") + "/api/generate"
        self.model = model
        self.timeout = timeout_s

    def _call(self, b64: str) -> VlmResult | None:
        resp = httpx.post(
            self.url,
            json={
                "model": self.model,
                "prompt": PROMPT,
                "images": [b64],
                "stream": False,
                "format": "json",
                "options": {"temperature": 0},
            },
            timeout=self.timeout,
        )
        resp.raise_for_status()
        body = json.loads(resp.json().get("response") or "{}")
        text = body.get("text")
        if not isinstance(text, str) or not text.strip():
            return None
        conf = body.get("confidence", 0.5)
        try:
            c = min(1.0, max(0.0, float(conf)))
        except (TypeError, ValueError):
            c = 0.5
        return VlmResult(text.strip(), c)

    def read(self, img: Image) -> VlmResult | None:
        ok, buf = cv2.imencode(".png", img)
        if not ok:
            return None
        b64 = base64.b64encode(buf.tobytes()).decode()
        for attempt in (1, 2):
            try:
                return self._call(b64)
            except (httpx.HTTPError, ValueError, json.JSONDecodeError) as e:
                log.warning("vlm_failed", attempt=attempt, error=f"{type(e).__name__}: {e}")
        return None
