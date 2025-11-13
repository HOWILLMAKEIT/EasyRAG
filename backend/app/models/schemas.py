from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    """健康检查响应。"""
    ok: bool = True
    message: str = "alive"


class IngestRequest(BaseModel):
    """入库请求：只接受 rebuild 标志。"""
    rebuild: bool = True


class IngestResponse(BaseModel):
    """入库（ingest）结果：文件数、切片数与索引目录。"""
    ok: bool = True
    files: int = Field(ge=0)
    chunks: int = Field(ge=0)
    index_dir: str


class AskRequest(BaseModel):
    """问答请求：包含中文问题与可选 Top‑K。"""
    question: str = Field(min_length=2, description="中文问题")
    top_k: Optional[int] = Field(default=None, ge=1, le=20)


class ContextChunk(BaseModel):
    """引用片段：来源、页/节、文本内容。"""
    source: str
    page: Optional[str] = None
    text: str


class AskResponse(BaseModel):
    """问答响应：中文答案、引用片段与耗时（毫秒）。"""
    answer: str
    contexts: List[ContextChunk]
    latency_ms: int
