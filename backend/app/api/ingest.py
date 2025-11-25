from __future__ import annotations

from typing import List

from fastapi import APIRouter, HTTPException, status, UploadFile, File, Form, Path

from ..core.rag import ingest_corpus
from ..core.settings import get_settings
from ..models.schemas import IngestRequest, IngestResponse

router = APIRouter(tags=["ingest", "kb"])


@router.post("/ingest", response_model=IngestResponse)
async def ingest_endpoint(payload: IngestRequest) -> IngestResponse:
    """构建/重建指定知识库的索引：从该知识库对应 RAW 目录读取所有文档。"""
    cfg = get_settings()
    try:
        files, chunks = ingest_corpus(kb=payload.kb, rebuild=payload.rebuild, settings=cfg)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return IngestResponse(ok=True, files=files, chunks=chunks, index_dir=str(cfg.index_dir / payload.kb))


@router.post("/kb/{kb}/upload", response_model=IngestResponse)
async def ingest_upload_endpoint(
    kb: str = Path(..., description="知识库名称"),
    files: List[UploadFile] = File(..., description="待入库的课程/知识库文档"),
    rebuild: bool = Form(True, description="是否全量重建索引，默认 true"),
) -> IngestResponse:
    """上传文件到指定知识库并构建/重建索引，对应前端 Ingest 页的上传入口。"""
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请至少上传一个文件")

    cfg = get_settings()
    # 将上传文件保存到该知识库的 RAW_DIR/kb
    kb_cfg = cfg.model_copy()
    kb_cfg.raw_dir = (cfg.raw_dir / kb).resolve()
    kb_cfg.index_dir = (cfg.index_dir / kb).resolve()
    kb_cfg.raw_dir.mkdir(parents=True, exist_ok=True)
    kb_cfg.index_dir.mkdir(parents=True, exist_ok=True)

    for uploaded in files:
        filename = uploaded.filename or "unnamed"
        safer_name = filename.replace("\\", "/").split("/")[-1]
        target_path = kb_cfg.raw_dir / safer_name
        content = await uploaded.read()
        try:
            with open(target_path, "wb") as f:
                f.write(content)
        except OSError as exc:  # 磁盘权限/空间等问题
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"保存文件失败：{safer_name}，原因：{exc}",
            ) from exc

    # 保存成功后，调用 ingest_corpus 进行索引构建
    try:
        files_count, chunks = ingest_corpus(kb=kb, rebuild=rebuild, settings=cfg)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return IngestResponse(ok=True, files=files_count, chunks=chunks, index_dir=str(cfg.index_dir / kb))
