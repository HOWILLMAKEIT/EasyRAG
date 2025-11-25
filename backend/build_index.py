"""命令行工具：使用本地 RAW_DIR 构建/重建索引。"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from app.core.rag import ingest_corpus
from app.core.settings import get_settings


def main() -> None:
    logs_dir = Path("logs")
    logs_dir.mkdir(exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(logs_dir / "build_index.log", encoding="utf-8"),
        ],
        force=True,
    )
    parser = argparse.ArgumentParser(description="构建 EasyRAG 本地索引")
    parser.add_argument(
        "--rebuild",
        action="store_true",
        default=True,
        help="是否全量重建索引（默认开启）",
    )
    args = parser.parse_args()

    cfg = get_settings()
    files, chunks = ingest_corpus(rebuild=args.rebuild, settings=cfg)
    print(f"索引构建完成：文件 {files} 个，切片 {chunks} 个，目录 {cfg.index_dir}")


if __name__ == "__main__":
    main()
