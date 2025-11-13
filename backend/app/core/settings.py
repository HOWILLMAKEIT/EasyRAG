from functools import lru_cache
from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """应用配置：从环境变量/.env 读取的统一入口。

    注意：显式把 .env 绑定为 backend/.env（与运行目录无关），
    避免从项目根目录或其他 CWD 运行时找不到 .env 导致读取默认值。
    """

    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # 生成模型（DeepSeek）配置
    deepseek_api_key: str = Field(default="", env="DEEPSEEK_API_KEY")
    deepseek_model: str = Field(default="deepseek-chat", env="DEEPSEEK_MODEL")
    deepseek_base_url: str = Field(default="https://api.deepseek.com", env="DEEPSEEK_BASE_URL")
    # 嵌入（仅使用通义千问 Qwen / DashScope）
    embed_model: str = Field(default="text-embedding-v4", env="EMBED_MODEL")
    embed_dimension: int = Field(default=1024)
    qwen_api_key: str = Field(default="", env="QWEN_API_KEY")
    index_dir: Path = Field(default=Path("./data/index"), env="INDEX_DIR")
    raw_dir: Path = Field(default=Path("./data/raw"), env="RAW_DIR")
    chunk_size: int = Field(default=1000)
    chunk_overlap: int = Field(default=120)
    similarity_top_k: int = Field(default=6)
    context_token_budget: int = Field(default=2500)
    request_timeout: int = Field(default=60)

    # 兼容 v1 风格的 Config 写法已迁移至 model_config


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """进程级缓存配置，并确保索引/语料目录存在。

    额外保障：在实例化 Settings 之前，显式加载 backend/.env，
    避免 CWD 变化导致 .env 未被读取的情况。
    """

    # 强制从 backend/.env 载入（不依赖当前工作目录）
    load_dotenv(dotenv_path=str(BACKEND_DIR / ".env"), override=True)

    settings = Settings()
    # 统一将相对路径锚定到 backend 目录，避免 CWD 不一致导致找不到索引/语料
    if not settings.index_dir.is_absolute():
        settings.index_dir = (BACKEND_DIR / settings.index_dir).resolve()
    if not settings.raw_dir.is_absolute():
        settings.raw_dir = (BACKEND_DIR / settings.raw_dir).resolve()

    # 确保目录存在：FAISS 持久化目录与原始资料目录
    settings.index_dir.mkdir(parents=True, exist_ok=True)
    settings.raw_dir.mkdir(parents=True, exist_ok=True)
    return settings
