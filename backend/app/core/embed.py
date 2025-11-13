from __future__ import annotations

from functools import lru_cache
from typing import List
import asyncio

from llama_index.core.embeddings import BaseEmbedding

from .settings import Settings, get_settings


class QwenEmbedding(BaseEmbedding):
    """通义千问（DashScope）TextEmbedding 封装（非兼容模式）。

    说明：BaseEmbedding 在 LlamaIndex 中基于 Pydantic 模型，
    因此需要将字段以类型注解的形式声明在类上，而不是仅在 __init__ 中赋值。
    """

    api_key: str
    model: str
    timeout: int = 60
    expected_dim: int | None = None

    def _extract_embeddings(self, resp) -> List[List[float]]:
        try:
            output = getattr(resp, "output", None) or {}
            items = output.get("embeddings") or output.get("data") or []
            return [it["embedding"] for it in items]
        except Exception as exc:  # pragma: no cover
            raise RuntimeError("Qwen/DashScope 嵌入响应解析失败") from exc

    def _batch_request(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        try:
            from http import HTTPStatus
            import dashscope  # type: ignore
            from dashscope import TextEmbedding  # type: ignore

            dashscope.api_key = self.api_key
            parameters = None
            resp = TextEmbedding.call(
                model=self.model,
                input=texts,
                timeout=self.timeout,
                parameters=parameters,
            )
            if getattr(resp, "status_code", None) not in (HTTPStatus.OK, 200):
                message = getattr(resp, "message", "Qwen 嵌入请求失败")
                raise RuntimeError(str(message))
            vectors = self._extract_embeddings(resp)
            if vectors and self.expected_dim and len(vectors[0]) != int(self.expected_dim):
                raise ValueError(
                    f"Qwen 嵌入返回维度 {len(vectors[0])}，与配置的嵌入维度 {self.expected_dim} 不一致"
                )
            return vectors
        except Exception as exc:  # pragma: no cover
            raise RuntimeError("Qwen 嵌入计算失败") from exc

    # ---- LlamaIndex BaseEmbedding 抽象方法实现 ----
    def _get_text_embedding(self, text: str) -> List[float]:  # type: ignore[override]
        return self._batch_request([text])[0]

    def _get_query_embedding(self, query: str) -> List[float]:  # type: ignore[override]
        return self._get_text_embedding(query)

    async def _aget_query_embedding(self, query: str) -> List[float]:  # type: ignore[override]
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._get_query_embedding, query)


@lru_cache(maxsize=1)
def get_embedding_model(settings: Settings | None = None) -> BaseEmbedding:
    """返回 Qwen 嵌入模型实例（唯一实现）。"""

    cfg = settings or get_settings()
    if not cfg.qwen_api_key:
        raise ValueError("QWEN_API_KEY 未配置，无法计算嵌入")
    return QwenEmbedding(
        api_key=cfg.qwen_api_key,
        model=cfg.embed_model,
        timeout=cfg.request_timeout,
        expected_dim=int(cfg.embed_dimension),
    )
