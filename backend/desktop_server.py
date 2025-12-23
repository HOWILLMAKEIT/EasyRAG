"""Desktop entrypoint for EasyRAG backend."""

from __future__ import annotations

import os

import uvicorn

from main import create_app


def main() -> None:
    port = int(os.getenv("EASYRAG_PORT", "8000"))
    app = create_app()
    uvicorn.run(app, host="127.0.0.1", port=port, reload=False)


if __name__ == "__main__":
    main()
