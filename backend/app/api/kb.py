from __future__ import annotations

import os
from pathlib import Path
from typing import List

from fastapi import APIRouter, HTTPException, Path as ApiPath, Body

from ..core.settings import get_settings
from ..core.rag import ingest_corpus
from ..models.schemas import (
    KnowledgeBaseInfo,
    KnowledgeBaseListResponse,
    KnowledgeBaseCreateRequest,
    KnowledgeBaseFilesResponse,
    KnowledgeBaseFileInfo,
    IngestResponse,
    KnowledgeBaseDeleteFilesRequest,
)

router = APIRouter(prefix="/kb", tags=["kb"])


def _safe_kb_name(name: str) -> str:
    """简单约束知识库名称，避免路径穿越等问题。"""
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="知识库名称不能为空")
    # 只保留常见安全字符
    for ch in name:
        if not (ch.isalnum() or ch in ("-", "_")):
            raise HTTPException(status_code=400, detail="知识库名称仅支持字母、数字、-、_")
    return name


@router.get("", response_model=KnowledgeBaseListResponse)
async def list_kbs() -> KnowledgeBaseListResponse:
    """列出所有知识库及其文档数量。"""
    cfg = get_settings()
    raw_root = cfg.raw_dir
    items: List[KnowledgeBaseInfo] = []
    if raw_root.exists():
        for entry in raw_root.iterdir():
            if not entry.is_dir():
                continue
            files_count = sum(
                1 for p in entry.iterdir() if p.is_file()
            )
            items.append(KnowledgeBaseInfo(name=entry.name, files=files_count))
    return KnowledgeBaseListResponse(items=items)


@router.post("", response_model=KnowledgeBaseInfo)
async def create_kb(payload: KnowledgeBaseCreateRequest) -> KnowledgeBaseInfo:
    """创建新的知识库目录。"""
    cfg = get_settings()
    name = _safe_kb_name(payload.name)
    kb_raw = (cfg.raw_dir / name).resolve()
    kb_index = (cfg.index_dir / name).resolve()
    if kb_raw.exists():
        raise HTTPException(status_code=400, detail="同名知识库已存在")
    kb_raw.mkdir(parents=True, exist_ok=True)
    kb_index.mkdir(parents=True, exist_ok=True)
    return KnowledgeBaseInfo(name=name, files=0)


@router.delete("/{kb}", response_model=None, status_code=204)
async def delete_kb(kb: str = ApiPath(..., description="知识库名称")) -> None:
    """删除指定知识库（原始文档与索引目录）。"""
    cfg = get_settings()
    name = _safe_kb_name(kb)
    for root in (cfg.raw_dir / name, cfg.index_dir / name):
        if root.exists():
            for child in root.iterdir():
                if child.is_file():
                    child.unlink(missing_ok=True)  # type: ignore[arg-type]
                else:
                    # 简单递归删除子目录
                    for p, _, files in os.walk(child, topdown=False):
                        for f in files:
                            Path(p, f).unlink(missing_ok=True)  # type: ignore[arg-type]
                        Path(p).rmdir()
            root.rmdir()


@router.get("/{kb}/files", response_model=KnowledgeBaseFilesResponse)
async def list_kb_files(kb: str = ApiPath(..., description="知识库名称")) -> KnowledgeBaseFilesResponse:
    """列出指定知识库中的文件。"""
    cfg = get_settings()
    name = _safe_kb_name(kb)
    kb_raw = (cfg.raw_dir / name).resolve()
    if not kb_raw.exists():
        raise HTTPException(status_code=404, detail="知识库不存在")
    files: List[KnowledgeBaseFileInfo] = []
    for p in kb_raw.iterdir():
        if not p.is_file():
            continue
        stat = p.stat()
        files.append(
            KnowledgeBaseFileInfo(
                name=p.name,
                size=stat.st_size,
                modified_ts=stat.st_mtime,
            )
        )
    return KnowledgeBaseFilesResponse(kb=name, files=files)


@router.post("/{kb}/rebuild", response_model=IngestResponse)
async def rebuild_kb_index(kb: str = ApiPath(..., description="知识库名称")) -> IngestResponse:
    """手动触发指定知识库的全量索引重建。"""
    cfg = get_settings()
    name = _safe_kb_name(kb)
    try:
        files, chunks = ingest_corpus(kb=name, rebuild=True, settings=cfg)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return IngestResponse(ok=True, files=files, chunks=chunks, index_dir=str(cfg.index_dir / name))


@router.delete("/{kb}/files", response_model=KnowledgeBaseFilesResponse)
async def delete_kb_files(
    kb: str = ApiPath(..., description="知识库名称"),
    payload: KnowledgeBaseDeleteFilesRequest = Body(...),
) -> KnowledgeBaseFilesResponse:
    """删除指定知识库中的一个或多个文件，并返回最新文件列表。"""
    cfg = get_settings()
    name = _safe_kb_name(kb)
    kb_raw = (cfg.raw_dir / name).resolve()
    if not kb_raw.exists():
        raise HTTPException(status_code=404, detail="知识库不存在")

    for filename in payload.names:
        safer_name = filename.replace("\\", "/").split("/")[-1]
        target = kb_raw / safer_name
        if target.exists() and target.is_file():
            target.unlink()

    # 返回删除后的文件列表
    files: List[KnowledgeBaseFileInfo] = []
    for p in kb_raw.iterdir():
        if not p.is_file():
            continue
        stat = p.stat()
        files.append(
            KnowledgeBaseFileInfo(
                name=p.name,
                size=stat.st_size,
                modified_ts=stat.st_mtime,
            )
        )
    return KnowledgeBaseFilesResponse(kb=name, files=files)
