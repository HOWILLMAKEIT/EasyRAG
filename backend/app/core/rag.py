from __future__ import annotations

import shutil
import tempfile
import time
from pathlib import Path
from typing import List, Sequence

import logging
from llama_index.core import SimpleDirectoryReader
from llama_index.core import Settings as LISettings
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.schema import BaseNode

from .embed import get_embedding_model
from .generator import generate_answer
from .index import build_and_persist_index, load_persisted_index
from .retriever import as_topk_retriever
from .settings import Settings, get_settings

SUPPORTED_EXTS = [".pdf", ".pptx", ".md"]
CHAR_PER_TOKEN = 4  # 粗略换算，限制上下文长度

logger = logging.getLogger(__name__)


def _load_documents(raw_dir: Path) -> list:
    """从原始资料目录读取 PDF/PPTX/MD，并补充 source 元信息。"""
    reader = SimpleDirectoryReader(
        input_dir=str(raw_dir),
        required_exts=SUPPORTED_EXTS,
        recursive=True,
        filename_as_id=True,
        file_metadata=lambda fp: {"source": Path(fp).name},
    )
    documents = reader.load_data()
    for doc in documents:
        doc.metadata.setdefault("source", doc.metadata.get("file_name") or doc.metadata.get("file_path"))
    return documents


def _prepare_nodes(documents: Sequence, settings: Settings) -> List[BaseNode]:
    """按固定窗口切分文档，生成可嵌入的节点集合。"""
    splitter = SentenceSplitter(chunk_size=settings.chunk_size, chunk_overlap=settings.chunk_overlap)
    nodes: List[BaseNode] = splitter.get_nodes_from_documents(documents)
    timestamp = int(time.time())
    for node in nodes:
        node.metadata.setdefault("timestamp", timestamp)
    return nodes


def ingest_corpus(rebuild: bool, settings: Settings | None = None) -> tuple[int, int]:
    """执行 ingest：可选重建、解析+切分、向量化并持久化 FAISS 索引。"""
    cfg = settings or get_settings()
    logger.info("开始构建索引：rebuild=%s，原始目录=%s", rebuild, cfg.raw_dir)
    if rebuild and cfg.index_dir.exists():
        logger.info("清空已有索引目录：%s", cfg.index_dir)
        shutil.rmtree(cfg.index_dir)
    documents = _load_documents(cfg.raw_dir)
    if not documents:
        raise ValueError("RAW_DIR 中没有可用的课程资料")
    logger.info("已从原始目录读取文档：%s 个", len(documents))

    # 设置全局嵌入模型（LlamaIndex 新推荐写法，替代 ServiceContext）
    embed_model = get_embedding_model()
    LISettings.embed_model = embed_model
    nodes = _prepare_nodes(documents, cfg)
    logger.info("已切分节点：%s 个（chunk_size=%s，overlap=%s）", len(nodes), cfg.chunk_size, cfg.chunk_overlap)
    build_and_persist_index(nodes, cfg)
    file_names = {doc.metadata.get("source") or doc.doc_id for doc in documents}
    return len(file_names), len(nodes)


async def ingest_uploaded_files(
    files: List,  # List[UploadFile]
    rebuild: bool,
    settings: Settings | None = None,
) -> tuple[int, int]:
    """处理上传的文件并构建索引。"""
    cfg = settings or get_settings()
    
    # 如果需要重建，清空索引
    if rebuild and cfg.index_dir.exists():
        logger.info("清空已有索引目录：%s", cfg.index_dir)
        shutil.rmtree(cfg.index_dir)
        cfg.index_dir.mkdir(parents=True, exist_ok=True)
    
    # 创建临时目录保存上传的文件
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        logger.info(f"临时目录: {temp_path}")
        
        # 保存上传的文件
        saved_files = []
        for file in files:
            file_path = temp_path / file.filename
            content = await file.read()
            file_path.write_bytes(content)
            saved_files.append(file.filename)
            logger.info(f"已保存上传文件: {file.filename} ({len(content)} bytes)")
        
        # 加载文档
        reader = SimpleDirectoryReader(
            input_dir=str(temp_path),
            required_exts=SUPPORTED_EXTS,
            recursive=False,
            filename_as_id=True,
            file_metadata=lambda fp: {"source": Path(fp).name},
        )
        documents = reader.load_data()
        
        if not documents:
            raise ValueError("无法解析上传的文件，请检查文件格式")
        
        logger.info(f"已解析文档：{len(documents)} 个")
        
        # 补充元信息
        for doc in documents:
            doc.metadata.setdefault(
                "source", 
                doc.metadata.get("file_name") or doc.metadata.get("file_path")
            )
        
        # 设置全局嵌入模型
        embed_model = get_embedding_model()
        LISettings.embed_model = embed_model
        
        # 切分节点
        nodes = _prepare_nodes(documents, cfg)
        logger.info(
            f"已切分节点：{len(nodes)} 个（chunk_size={cfg.chunk_size}，overlap={cfg.chunk_overlap}）"
        )
        
        # 构建索引
        build_and_persist_index(nodes, cfg)
        
        file_names = {doc.metadata.get("source") or doc.doc_id for doc in documents}
        return len(file_names), len(nodes)


def _context_budget_chars(settings: Settings) -> int:
    """将 token 预算粗略换算为字符上限。"""
    return settings.context_token_budget * CHAR_PER_TOKEN


def _to_context_dict(node: BaseNode) -> dict:
    """提取检索节点的关键信息（来源/页码/文本）。"""
    metadata = node.metadata or {}
    source = metadata.get("source") or metadata.get("file_name") or metadata.get("file_path") or "未知来源"
    page = metadata.get("page_label") or metadata.get("page") or metadata.get("slide")
    section = metadata.get("section")
    text = node.get_content(metadata_mode="LLM") if hasattr(node, "get_content") else node.text
    return {
        "source": source,
        "page": page or section,
        "text": text.strip(),
    }


def _trim_contexts(contexts: list[dict], settings: Settings) -> list[dict]:
    """基于长度预算裁剪上下文，保留高分片段。"""
    max_chars = _context_budget_chars(settings)
    total = 0
    trimmed: list[dict] = []
    for ctx in contexts:
        if not ctx["text"]:
            continue
        length = len(ctx["text"])
        if total + length > max_chars and trimmed:
            break
        trimmed.append(ctx)
        total += length
    return trimmed


def _build_context_prompt(contexts: list[dict]) -> str:
    """将片段组装为提示文本，带 [序号] 便于引用。"""
    lines = []
    for idx, ctx in enumerate(contexts, start=1):
        lines.append(f"[{idx}] {ctx['text']}")
    return "\n".join(lines)


def retrieve_and_answer(question: str, top_k: int | None, settings: Settings | None = None) -> tuple[str, list[dict], int]:
    """加载索引→Top‑K 检索→上下文拼接→调用生成→返回答案与引用。"""
    cfg = settings or get_settings()
    start = time.perf_counter()

    logger.info("收到提问：%s，Top-K=%s", question, top_k)

    # 使用全局 Settings 设置嵌入模型，避免已弃用的 ServiceContext
    embed_model = get_embedding_model()
    LISettings.embed_model = embed_model
    contexts: list[dict]
    try:
        index = load_persisted_index(cfg)
        retriever = as_topk_retriever(index, top_k or cfg.similarity_top_k)
        nodes = retriever.retrieve(question)
        contexts = [_to_context_dict(node) for node in nodes]
    except FileNotFoundError as exc:
        logger.warning("加载 LlamaIndex 索引失败，尝试手动 FAISS 检索：%s", exc)
        contexts = _manual_faiss_retrieve(question, top_k or cfg.similarity_top_k, cfg)
    # 控制总长度，避免超出生成模型可用的上下文窗口
    contexts = _trim_contexts(contexts, cfg)
    logger.info("检索到上下文片段：%s 个（已按预算裁剪）", len(contexts))

    if not contexts:
        # 没有召回任何片段，通常是未建索引或语料缺失
        raise ValueError("索引中没有匹配到任何片段，请先 ingest")

    context_prompt = _build_context_prompt(contexts)
    generation = generate_answer(question, context_prompt, cfg)
    latency_ms = int((time.perf_counter() - start) * 1000)
    return generation["answer"], contexts, max(latency_ms, generation["latency_ms"])


def _manual_faiss_retrieve(question: str, top_k: int, settings: Settings) -> list[dict]:
    """不依赖 LlamaIndex 存储格式，直接以 FAISS + docstore.json 检索。

    逻辑：
    - 读取 FAISS 索引（优先 faiss.index；否则 default__vector_store.json 作为二进制）
    - 读取 index_store.json 的 nodes_dict 作为 [位置]->node_id 映射
    - 读取 docstore.json 获取 node_id -> 文本/元数据
    - 调用嵌入模型对问题编码，faiss.search 取 Top‑K，拼装上下文
    """
    import json
    from pathlib import Path
    import logging
    logger = logging.getLogger(__name__)

    persist_dir = Path(settings.index_dir)
    faiss_idx_path = persist_dir / "faiss.index"
    alt_idx_path = persist_dir / "default__vector_store.json"

    try:
        import faiss  # type: ignore
        import numpy as np  # type: ignore
    except Exception as exc:  # pragma: no cover
        raise FileNotFoundError("环境缺少 faiss/numpy，无法检索") from exc

    if faiss_idx_path.exists():
        idx_path = faiss_idx_path
    elif alt_idx_path.exists():
        idx_path = alt_idx_path
    else:
        raise FileNotFoundError(f"索引文件缺失：{faiss_idx_path} / {alt_idx_path}")

    try:
        faiss_index = faiss.read_index(str(idx_path))
    except Exception as exc:  # 二进制读取失败
        raise FileNotFoundError(f"无法读取 FAISS 索引：{idx_path}") from exc

    # 加载节点映射
    idx_store_path = persist_dir / "index_store.json"
    docstore_path = persist_dir / "docstore.json"
    if not idx_store_path.exists() or not docstore_path.exists():
        raise FileNotFoundError("索引存储不完整，缺少 index_store.json 或 docstore.json")

    idx_map: dict[int, str]
    with open(idx_store_path, "r", encoding="utf-8") as f:
        data = json.load(f)
        # 结构示例：{"index_store/data": {"<index_id>": {"__type__": "vector_store", "__data__": "{...json string...}"}}}
        data_section = data.get("index_store/data", {})
        first_key = next(iter(data_section), None)
        if first_key is None:
            raise FileNotFoundError("index_store.json 为空")
        raw_entry = data_section.get(first_key, {})
        inner = raw_entry.get("__data__")
        if isinstance(inner, str):
            try:
                inner = json.loads(inner)
            except Exception as exc:
                raise FileNotFoundError("index_store.json 内部数据解析失败") from exc
        if not isinstance(inner, dict):
            raise FileNotFoundError("index_store.json 格式不兼容")
        nodes = inner.get("nodes_dict")
        if not isinstance(nodes, dict):
            raise FileNotFoundError("index_store.json 缺少 nodes_dict")
        idx_map = {int(k): v for k, v in nodes.items()}

    with open(docstore_path, "r", encoding="utf-8") as f:
        doc = json.load(f)
        ds = doc.get("docstore/data", {})

    # 嵌入查询并检索
    embed = get_embedding_model(settings)
    qv = embed.get_query_embedding(question)
    xq = np.asarray([qv], dtype="float32")
    k = max(1, int(top_k))
    try:
        D, I = faiss_index.search(xq, k)
    except Exception as exc:
        raise FileNotFoundError("FAISS 检索失败") from exc

    contexts: list[dict] = []
    for idx in I[0]:
        if int(idx) < 0:
            continue
        node_id = idx_map.get(int(idx))
        if not node_id:
            continue
        entry = ds.get(node_id, {})
        payload = entry.get("__data__") or entry
        text = payload.get("text") if isinstance(payload, dict) else None
        metadata = payload.get("metadata", {}) if isinstance(payload, dict) else {}
        if not text:
            continue
        contexts.append(
            {
                "source": metadata.get("source") or "未知来源",
                "page": metadata.get("page_label") or metadata.get("page") or metadata.get("slide"),
                "text": str(text).strip(),
            }
        )
    return contexts
