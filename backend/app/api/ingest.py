from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from ..core.rag import ingest_corpus
from ..core.settings import get_settings
from ..models.schemas import IngestRequest, IngestResponse

router = APIRouter(prefix="/ingest", tags=["ingest"])


@router.post("", response_model=IngestResponse)
async def ingest_endpoint(payload: IngestRequest) -> IngestResponse:
    """构建/重建课程资料索引：仅支持读取本地 RAW_DIR。"""
    cfg = get_settings()
    try:
        files, chunks = ingest_corpus(rebuild=payload.rebuild, settings=cfg)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return IngestResponse(ok=True, files=files, chunks=chunks, index_dir=str(cfg.index_dir))
