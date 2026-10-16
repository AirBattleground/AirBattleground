"""structlog JSON logging with a per-request id (contextvars), shared by every module."""

from __future__ import annotations

import logging
import sys
import uuid
from typing import Any

import structlog

_configured = False


def configure_logging(level: str = "INFO", json: bool = True) -> None:
    global _configured
    if _configured:
        return
    logging.basicConfig(
        stream=sys.stdout, level=getattr(logging, level.upper(), logging.INFO), format="%(message)s"
    )
    renderer: Any = structlog.processors.JSONRenderer() if json else structlog.dev.ConsoleRenderer()
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, level.upper(), logging.INFO)),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
    _configured = True


def get_logger(name: str | None = None) -> Any:
    return structlog.get_logger(name)


def new_request_id(incoming: str | None = None) -> str:
    """Use the caller's X-Request-ID when it looks sane, otherwise mint one; bind it to the log context."""
    rid = (
        incoming if incoming and 0 < len(incoming) <= 64 and incoming.isprintable() else uuid.uuid4().hex[:16]
    )
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(request_id=rid)
    return rid
