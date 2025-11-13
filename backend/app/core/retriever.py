from llama_index.core import VectorStoreIndex


def as_topk_retriever(index: VectorStoreIndex, top_k: int):
    """返回按相似度召回的 Top-K 检索器。"""

    top_k = max(1, top_k)
    return index.as_retriever(similarity_top_k=top_k)
