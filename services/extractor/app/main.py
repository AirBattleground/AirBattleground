"""FastAPI app factory. Routers: app.api.extract (pipeline work) and app.api.training (ML work)."""

from __future__ import annotations

import importlib

from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="7xen extractor", version="0.1.0")
    for module in ("app.api.extract", "app.api.training"):
        try:
            mod = importlib.import_module(module)
        except ModuleNotFoundError as e:  # router not built yet
            if e.name != module:
                raise
            continue
        app.include_router(mod.router)
        if hasattr(mod, "on_startup"):
            app.add_event_handler("startup", mod.on_startup)
    return app


app = create_app()
