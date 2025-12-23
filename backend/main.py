import logging
import os
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import ask, health, ingest, kb
from app.core.settings import get_settings

LOG_DIR = Path("logs")
LOG_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_DIR / "app.log", encoding="utf-8"),
    ],
    force=True,
)


def create_app() -> FastAPI:
    """创建 FastAPI 应用并挂载路由与 CORS。"""
    cfg = get_settings()
    app = FastAPI(title="EasyRAG API", version="0.1.0")

    # CORS：开发环境默认放行 Vite 开发服务器；生产可用环境变量覆盖
    cors_env = os.getenv("CORS_ALLOW_ORIGINS", "").strip()
    if cors_env:
        allow_origins = [o.strip() for o in cors_env.split(",") if o.strip()]
    else:
        allow_origins = [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]
    cors_credentials_env = os.getenv("CORS_ALLOW_CREDENTIALS", "").strip().lower()
    if cors_credentials_env:
        allow_credentials = cors_credentials_env not in {"0", "false", "no"}
    else:
        allow_credentials = True
    if "*" in allow_origins:
        # Avoid invalid CORS headers when allowing any origin.
        allow_credentials = False

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_credentials=allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(kb.router)
    app.include_router(ingest.router)
    app.include_router(ask.router)

    return app


app = create_app()
