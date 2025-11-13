from pathlib import Path
from typing import Sequence

from llama_index.core import StorageContext, VectorStoreIndex, load_index_from_storage
from llama_index.core.schema import BaseNode
from llama_index.vector_stores.faiss import FaissVectorStore

from .settings import Settings


def build_and_persist_index(
    nodes: Sequence[BaseNode],
    settings: Settings,
) -> None:
    """基于节点集合构建 FAISS 向量索引并持久化到磁盘。

    依据本地文档与实际包版本：不直接传递 dimension 参数，
    而是先外部创建 faiss.Index（指定维度），再注入 FaissVectorStore。
    """

    # 先构造 faiss 原生索引，并指定维度（L2 度量，可按需改为 IndexFlatIP 做内积）
    try:
        import faiss  # type: ignore
    except Exception as exc:  # pragma: no cover - 环境缺失
        raise RuntimeError("未安装 faiss-cpu，请先通过 conda 安装 faiss-cpu") from exc

    faiss_index = faiss.IndexFlatL2(int(settings.embed_dimension))
    vector_store = FaissVectorStore(faiss_index=faiss_index)
    storage_context = StorageContext.from_defaults(vector_store=vector_store)
    # 使用全局 Settings（已在上层设置 embed_model）创建向量索引
    VectorStoreIndex(nodes, storage_context=storage_context)
    storage_context.persist(persist_dir=str(settings.index_dir))
    # 额外落地原生 FAISS 索引，便于无需 LlamaIndex 直接加载
    try:  # pragma: no cover - 辅助持久化
        faiss.write_index(faiss_index, str(Path(settings.index_dir) / "faiss.index"))
    except Exception:
        pass


def load_persisted_index(settings: Settings) -> VectorStoreIndex:
    """从磁盘加载已存在的索引。

    优先尝试绑定原生 FAISS 索引（faiss.index 或 default__vector_store.json 作为二进制），
    再委托 LlamaIndex 的 load_index_from_storage，避免某些平台将二进制误按 UTF-8 解码。
    """

    persist_dir = Path(settings.index_dir)
    if not persist_dir.exists() or not any(persist_dir.iterdir()):
        raise FileNotFoundError(
            f"索引目录 {persist_dir} 不存在或为空，请先执行 ingest"
        )

    vector_store = None
    try:
        import faiss  # type: ignore
    except Exception:
        faiss = None  # type: ignore

    if faiss is not None:
        faiss_idx_path = persist_dir / "faiss.index"
        default_vs_path = persist_dir / "default__vector_store.json"
        try:
            if faiss_idx_path.exists():
                faiss_index = faiss.read_index(str(faiss_idx_path))
                vector_store = FaissVectorStore(faiss_index=faiss_index)
            elif default_vs_path.exists():
                # 某些版本会将 FAISS 二进制存为 default__vector_store.json
                faiss_index = faiss.read_index(str(default_vs_path))
                vector_store = FaissVectorStore(faiss_index=faiss_index)
        except Exception:
            # 如果无法读取，退回到 LlamaIndex 默认行为
            vector_store = None

    try:
        if vector_store is not None:
            storage_context = StorageContext.from_defaults(
                persist_dir=str(persist_dir), vector_store=vector_store
            )
        else:
            storage_context = StorageContext.from_defaults(persist_dir=str(persist_dir))
        return load_index_from_storage(storage_context)
    except Exception as exc:  # 目录存在但内容无效/不完整等
        raise FileNotFoundError(f"无法加载索引（{persist_dir}）：{exc}") from exc
