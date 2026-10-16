"""FastAPI app factory. Routers: app.api.extract (pipeline work) and app.api.training (ML work)."""

from __future__ import annotations

import importlib
import inspect
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI


def create_app() -> FastAPI:
    startups: list[Callable[[], Any]] = []

    # Starlette 1.x removed on_startup/add_event_handler: run each router module's on_startup in a lifespan.
    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        for fn in startups:
            res = fn()
            if inspect.isawaitable(res):
                await res
        yield

    app = FastAPI(title="7xen extractor", version="0.1.0", lifespan=lifespan)
    for module in ("app.api.extract", "app.api.training"):
        try:
            mod = importlib.import_module(module)
        except ModuleNotFoundError as e:  # router not built yet
            if e.name != module:
                raise
            continue
        app.include_router(mod.router)
        if hasattr(mod, "on_startup"):
            startups.append(mod.on_startup)
    return app


app = create_app()
