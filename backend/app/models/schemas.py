from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    """健康检查响应。"""
    ok: bool = True
    message: str = "alive"


class IngestRequest(BaseModel):
    """入库请求：指定知识库并决定是否重建索引。"""
    kb: str = Field(min_length=1, description="知识库名称")
    rebuild: bool = True


class IngestResponse(BaseModel):
    """入库（ingest）结果：文件数、切片数与索引目录。"""
    ok: bool = True
    files: int = Field(ge=0)
    chunks: int = Field(ge=0)
    index_dir: str


class AskRequest(BaseModel):
    """问答请求：包含知识库、中文问题与可选 Top‑K。"""
    kb: str = Field(min_length=1, description="知识库名称")
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


class KnowledgeBaseInfo(BaseModel):
    """知识库信息：ID（目录名）、展示名称与文档数量。"""
    id: str
    name: str
    files: int = 0


class KnowledgeBaseListResponse(BaseModel):
    """知识库列表响应。"""
    items: List[KnowledgeBaseInfo]


class KnowledgeBaseCreateRequest(BaseModel):
    """创建知识库请求。"""
    name: str = Field(min_length=1, max_length=64, description="知识库名称（目录名）")


class KnowledgeBaseFileInfo(BaseModel):
    """知识库中文件信息。"""
    name: str
    size: int
    modified_ts: float


class KnowledgeBaseFilesResponse(BaseModel):
    """知识库文件列表响应。"""
    kb: str
    files: List[KnowledgeBaseFileInfo]


class KnowledgeBaseDeleteFilesRequest(BaseModel):
    """删除知识库中文件的请求。"""
    names: List[str] = Field(min_length=1, description="要删除的文件名列表（相对于知识库根目录）")
