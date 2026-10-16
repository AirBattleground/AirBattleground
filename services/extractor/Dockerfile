# 7xen extractor — screenshot reader (FastAPI + OpenCV + PaddleOCR, CPU only).
# Build from the repo root:   docker build -t 7xen-extractor services/extractor
# or via compose:             docker-compose --profile full up -d --build extractor
#
# OCR models are downloaded at BUILD time into $PADDLE_PDX_CACHE_HOME and the runtime never contacts a
# model hoster (PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True). The service runs fully offline.

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/7xen/services/extractor/.venv \
    PATH=/opt/7xen/services/extractor/.venv/bin:$PATH \
    PADDLE_PDX_CACHE_HOME=/opt/paddlex

# libgomp1: paddle OpenMP runtime; libgl1/libglib2.0-0: opencv-contrib-python (pulled in by paddlex)
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 libgl1 libglib2.0-0 curl \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir uv==0.13.1

# mirror the repo layout (code derives repo-relative defaults from its own path)
WORKDIR /opt/7xen/services/extractor

# dependency layer (cached across source changes)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app
COPY synth ./synth
COPY eval ./eval

# pre-download the recognition models (stock + alternates from app/settings.py) — no network at runtime
RUN PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=False python -m app.pipeline.ocr_paddle --download \
 && useradd --system --uid 10001 --home /opt/7xen extractor \
 && mkdir -p /data/storage /data/models /data/debug \
 && chown -R extractor /data /opt/paddlex

ENV PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    STORAGE_DIR=/data/storage \
    MODELS_DIR=/data/models \
    DEBUG_DIR=/data/debug

USER extractor
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS http://localhost:8090/healthz | grep -q '"ocr_ready":true' || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090", "--workers", "1"]
