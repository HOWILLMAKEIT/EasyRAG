from __future__ import annotations

import logging
from typing import List

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from ..core.rag import ingest_corpus, ingest_uploaded_files
from ..core.settings import get_settings
from ..models.schemas import IngestRequest, IngestResponse

router = APIRouter(prefix="/ingest", tags=["ingest"])
logger = logging.getLogger(__name__)


@router.post("", response_model=IngestResponse)
async def ingest_endpoint(payload: IngestRequest) -> IngestResponse:
    """构建/重建课程资料索引：仅支持读取本地 RAW_DIR。"""
    cfg = get_settings()
    try:
        files, chunks = ingest_corpus(rebuild=payload.rebuild, settings=cfg)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return IngestResponse(ok=True, files=files, chunks=chunks, index_dir=str(cfg.index_dir))


@router.post("/upload", response_model=IngestResponse)
async def upload_and_ingest(
    files: List[UploadFile] = File(..., description="上传的文档文件(.pdf/.pptx/.md)"),
    rebuild: bool = Form(False, description="是否清空旧索引重建"),
) -> IngestResponse:
    """上传文档并构建索引：支持 PDF/PPTX/MD 格式。"""
    cfg = get_settings()
    
    # 验证文件格式
    supported_exts = {".pdf", ".pptx", ".md"}
    for file in files:
        if not file.filename:
            raise HTTPException(status_code=400, detail="文件名不能为空")
        ext = "." + file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
        if ext not in supported_exts:
            raise HTTPException(
                status_code=400, 
                detail=f"不支持的文件格式: {file.filename}，仅支持 .pdf/.pptx/.md"
            )
    
    logger.info(f"收到 {len(files)} 个上传文件，rebuild={rebuild}")
    
    try:
        file_count, chunk_count = await ingest_uploaded_files(
            files=files, 
            rebuild=rebuild, 
            settings=cfg
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error(f"处理上传文件失败: {exc}")
        raise HTTPException(status_code=500, detail=f"处理文件失败: {str(exc)}") from exc
    
    return IngestResponse(
        ok=True, 
        files=file_count, 
        chunks=chunk_count, 
        index_dir=str(cfg.index_dir)
    )
