from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Dict, List

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

META_FILENAME = "_kb_meta.json"
_KB_ID_PATTERN = re.compile(r"[^a-zA-Z0-9_-]+")


def _load_meta(raw_root: Path) -> Dict[str, dict]:
    path = raw_root / META_FILENAME
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        kbs = data.get("kbs")
        if isinstance(kbs, dict):
            return kbs
        return {}
    except Exception:
        return {}


def _save_meta(raw_root: Path, meta: Dict[str, dict]) -> None:
    path = raw_root / META_FILENAME
    payload = {"kbs": meta}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _generate_kb_id(display_name: str, existing_ids: set[str]) -> str:
    base = _KB_ID_PATTERN.sub("", display_name.replace(" ", "_")).lower() or "kb"
    base = base[:16]
    candidate = base
    i = 1
    while candidate in existing_ids:
        candidate = f"{base}-{i}"
        i += 1
    return candidate


@router.get("", response_model=KnowledgeBaseListResponse)
async def list_kbs() -> KnowledgeBaseListResponse:
    """列出所有知识库及其文档数量。"""
    cfg = get_settings()
    raw_root = cfg.raw_dir
    meta = _load_meta(raw_root)
    items: List[KnowledgeBaseInfo] = []
    if raw_root.exists():
        for entry in raw_root.iterdir():
            if not entry.is_dir() or entry.name == META_FILENAME:
                continue
            files_count = sum(
                1 for p in entry.iterdir() if p.is_file()
            )
            kb_id = entry.name
            info = meta.get(kb_id) or {}
            display_name = info.get("name") or kb_id
            items.append(KnowledgeBaseInfo(id=kb_id, name=display_name, files=files_count))
    return KnowledgeBaseListResponse(items=items)


@router.post("", response_model=KnowledgeBaseInfo)
async def create_kb(payload: KnowledgeBaseCreateRequest) -> KnowledgeBaseInfo:
    """创建新的知识库目录。"""
    cfg = get_settings()
    raw_root = cfg.raw_dir
    display_name = (payload.name or "").strip()
    if not display_name:
        raise HTTPException(status_code=400, detail="知识库名称不能为空")

    meta = _load_meta(raw_root)
    existing_ids: set[str] = set(meta.keys())
    if raw_root.exists():
        existing_ids.update(
            entry.name for entry in raw_root.iterdir() if entry.is_dir() and entry.name != META_FILENAME
        )

    kb_id = _generate_kb_id(display_name, existing_ids)
    kb_raw = (raw_root / kb_id).resolve()
    kb_index = (cfg.index_dir / kb_id).resolve()
    kb_raw.mkdir(parents=True, exist_ok=True)
    kb_index.mkdir(parents=True, exist_ok=True)

    meta[kb_id] = {"name": display_name}
    _save_meta(raw_root, meta)

    return KnowledgeBaseInfo(id=kb_id, name=display_name, files=0)


@router.delete("/{kb}", response_model=None, status_code=204)
async def delete_kb(kb: str = ApiPath(..., description="知识库名称")) -> None:
    """删除指定知识库（原始文档与索引目录）。"""
    cfg = get_settings()
    raw_root = cfg.raw_dir
    meta = _load_meta(raw_root)
    kb_id = kb.strip()
    if not kb_id:
        raise HTTPException(status_code=400, detail="知识库 ID 不能为空")

    for root in (cfg.raw_dir / kb_id, cfg.index_dir / kb_id):
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

    if kb_id in meta:
        del meta[kb_id]
        _save_meta(raw_root, meta)


@router.get("/{kb}/files", response_model=KnowledgeBaseFilesResponse)
async def list_kb_files(kb: str = ApiPath(..., description="知识库名称")) -> KnowledgeBaseFilesResponse:
    """列出指定知识库中的文件。"""
    cfg = get_settings()
    kb_id = kb.strip()
    kb_raw = (cfg.raw_dir / kb_id).resolve()
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
    return KnowledgeBaseFilesResponse(kb=kb_id, files=files)


@router.post("/{kb}/rebuild", response_model=IngestResponse)
async def rebuild_kb_index(kb: str = ApiPath(..., description="知识库名称")) -> IngestResponse:
    """手动触发指定知识库的全量索引重建。"""
    cfg = get_settings()
    try:
        files, chunks = ingest_corpus(kb=kb, rebuild=True, settings=cfg)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return IngestResponse(ok=True, files=files, chunks=chunks, index_dir=str(cfg.index_dir / kb))


@router.delete("/{kb}/files", response_model=KnowledgeBaseFilesResponse)
async def delete_kb_files(
    kb: str = ApiPath(..., description="知识库名称"),
    payload: KnowledgeBaseDeleteFilesRequest = Body(...),
) -> KnowledgeBaseFilesResponse:
    """删除指定知识库中的一个或多个文件，并返回最新文件列表。"""
    cfg = get_settings()
    kb_id = kb.strip()
    kb_raw = (cfg.raw_dir / kb_id).resolve()
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
    return KnowledgeBaseFilesResponse(kb=kb_id, files=files)
