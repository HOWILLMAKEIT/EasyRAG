from fastapi import APIRouter

from ..models.schemas import HealthResponse

router = APIRouter(prefix="/health", tags=["health"])


@router.get("", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """健康检查：用于存活探测/就绪探测。"""
    return HealthResponse()
