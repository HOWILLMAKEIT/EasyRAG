from __future__ import annotations

import time
from typing import Sequence

import requests

from .settings import Settings, get_settings

SYSTEM_PROMPT = (
    "你是“计算机网络”课程助教。仅依据提供的上下文回答中文问题；若上下文不足，请明确说明无法从资料中找到。"
    "回答简洁、结构清晰，并在文末给出引用标号 [1][2]…"
)


class GenerationResult(dict):
    """生成结果：包含模型回答与耗时（毫秒）。"""
    answer: str
    latency_ms: int


def _request_payload(question: str, context_text: str, settings: Settings) -> dict:
    """组装 DeepSeek 聊天接口请求体。"""
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"问题：{question}\n\n上下文：\n{context_text}"},
    ]
    return {"model": settings.deepseek_model, "messages": messages, "temperature": 0.2}


def generate_answer(question: str, context_text: str, settings: Settings | None = None) -> GenerationResult:
    """调用 DeepSeek 聊天接口生成答案。"""

    cfg = settings or get_settings()
    # 更严格的 Key 校验：占位符也视为未配置
    if not cfg.deepseek_api_key or cfg.deepseek_api_key.strip().lower() in {"", "your_deepseek_key", "placeholder"}:
        raise ValueError("DEEPSEEK_API_KEY 未配置或无效，无法生成答案")

    base_url = cfg.deepseek_base_url.rstrip("/")
    url = f"{base_url}/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {cfg.deepseek_api_key}",
        "Content-Type": "application/json",
    }
    payload = _request_payload(question, context_text, cfg)

    start = time.perf_counter()
    # 统一超时，失败抛出上层处理（不泄露密钥）
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=cfg.request_timeout)
        response.raise_for_status()
        data = response.json()
        answer = data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError) as exc:  # pragma: no cover - defensive
        raise RuntimeError("DeepSeek 响应格式异常") from exc
    except requests.HTTPError as exc:  # 返回非 2xx
        status = exc.response.status_code if exc.response is not None else "N/A"
        text = exc.response.text[:500] if exc.response is not None else str(exc)
        raise RuntimeError(f"DeepSeek 请求失败（HTTP {status}）：{text}") from exc
    except requests.RequestException as exc:  # 网络/超时等
        raise RuntimeError(f"DeepSeek 请求失败：{exc}") from exc

    latency_ms = int((time.perf_counter() - start) * 1000)
    return GenerationResult(answer=answer, latency_ms=latency_ms)
