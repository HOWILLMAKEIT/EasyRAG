from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from ..core.rag import retrieve_and_answer
from ..core.settings import get_settings
from ..models.schemas import AskRequest, AskResponse, ContextChunk

router = APIRouter(prefix="/ask", tags=["ask"])


@router.post("", response_model=AskResponse)
async def ask_question(payload: AskRequest) -> AskResponse:
    """问答接口：基于索引进行 Top‑K 检索并调用生成模型返回答案与引用。"""
    cfg = get_settings()
    try:
        answer, contexts, latency = retrieve_and_answer(payload.question, payload.top_k, cfg)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    context_models = [ContextChunk(**ctx) for ctx in contexts]
    return AskResponse(answer=answer, contexts=context_models, latency_ms=latency)
