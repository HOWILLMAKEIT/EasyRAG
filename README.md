<div align="center">
  <img src="assert/logo.png" alt="EasyRAG Logo" width="300" style="margin-left: 85px;" />
  <p style="margin-top: 0.8em; font-size: 1.5rem;">
    通用中文 RAG 助手
  </p>
  <p>
    <!-- Tech stack row 1 -->
    <img src="https://img.shields.io/badge/PYTHON-000000?style=flat-square&logo=python&logoColor=ffffff&labelColor=000000&color=000000" alt="Python" />
    <img src="https://img.shields.io/badge/3.11%2B-2b5bba?style=flat-square&labelColor=2b5bba&color=2b5bba" alt="3.11+" />
    <img src="https://img.shields.io/badge/BACKEND-000000?style=flat-square&labelColor=000000&color=000000" alt="Backend" />
    <img src="https://img.shields.io/badge/FASTAPI-05998b?style=flat-square&labelColor=05998b&color=05998b" alt="FastAPI" />
    <img src="https://img.shields.io/badge/RAG-000000?style=flat-square&labelColor=000000&color=000000" alt="RAG" />
    <img src="https://img.shields.io/badge/LLAMAINDEX-f57c00?style=flat-square&labelColor=f57c00&color=f57c00" alt="LlamaIndex" />
    <img src="https://img.shields.io/badge/EMBEDDING-000000?style=flat-square&labelColor=000000&color=000000" alt="Embedding" />
    <img src="https://img.shields.io/badge/QWEN%20v4%20(1024d)-4caf50?style=flat-square&labelColor=4caf50&color=4caf50" alt="Qwen v4 (1024d)" />
  </p>
  <p>
    <!-- Tech stack row 2 -->
    <img src="https://img.shields.io/badge/VECTOR%20STORE-000000?style=flat-square&labelColor=000000&color=000000" alt="Vector Store" />
    <img src="https://img.shields.io/badge/FAISS-546e7a?style=flat-square&labelColor=546e7a&color=546e7a" alt="FAISS" />
    <img src="https://img.shields.io/badge/LLM-000000?style=flat-square&labelColor=000000&color=000000" alt="LLM" />
    <img src="https://img.shields.io/badge/DEEPSEEK--CHAT-e91e63?style=flat-square&labelColor=e91e63&color=e91e63" alt="DeepSeek-chat" />
    <img src="https://img.shields.io/badge/FRONTEND-000000?style=flat-square&labelColor=000000&color=000000" alt="Frontend" />
    <img src="https://img.shields.io/badge/VITE%20%2B%20REACT-3f51b5?style=flat-square&labelColor=3f51b5&color=3f51b5" alt="Vite + React" />
  </p>
</div>

一个轻量、可复用的中文 RAG 助手（默认示例面向“计算机网络”课程，但可替换为任意自有语料），支持**多知识库管理**：
- 后端：FastAPI + LlamaIndex + FAISS
- 嵌入：通义千问 Qwen（DashScope，text-embedding-v4，固定 1024 维）
- 生成：DeepSeek-V3.2-Exp 的非思考模式
- 前端：Vite + React（TS），提供知识库管理 + 对话问答页面

---

<p align="center" style="margin-top: -8px;">
  <a href="#快速开始">快速开始</a>
  · <a href="#api-速览">API</a>
  · <a href="#特性与实现要点">特性</a>
  · <a href="#目录结构">结构</a>
  · <a href="#常见问题troubleshooting">常见问题</a>
</p>

## 快速开始

1) 安装后端依赖（建议 Conda on Windows）
```bash
conda create -n easyrag-py311 python=3.11 -y
conda activate easyrag-py311
conda install -c conda-forge faiss-cpu -y
cd backend
python -m pip install -U -r requirements.txt
```

2) 配置环境变量（backend/.env）
- 必填：`QWEN_API_KEY`、`DEEPSEEK_API_KEY`
- 可选：`DEEPSEEK_MODEL`（默认 `deepseek-chat`）、`DEEPSEEK_BASE_URL`（默认 `https://api.deepseek.com`）
- 路径：`INDEX_DIR=./data/index`、`RAW_DIR=./data/raw`（已自动锚定到 backend 目录）
- 注意：不需要 `EMBED_DIM`，已固定为 1024

3) 创建知识库并构建索引
```bash
# 在浏览器或直接调用接口创建知识库，例如 ID 为 my_kb
# 也可以直接在文件夹下建目录 backend/data/raw/my_kb 并放入 .pdf/.pptx/.md
cd backend
python build_index.py --kb my_kb --rebuild
```

4) 启动后端与前端
```bash
# 后端（backend 目录）
uvicorn main:app --reload --port 8000 --reload-exclude data

# 前端（另一个终端）
cd frontend/vite-react
npm install
npm run dev  # http://localhost:5173
```

---

## API 速览

- `GET /health`：存活检查
- `GET /kb`：列出所有知识库（ID + 展示名 + 文档数量）
- `POST /kb`：创建知识库（Body: `{ "name": "中文名称" }`，自动生成英文 ID 作为目录名）
- `GET /kb/{kb}/files`：查看某个知识库中的文件列表
- `POST /kb/{kb}/upload`：向指定知识库上传文档并可选重建索引（FormData: `files[]`, `rebuild`）
- `POST /kb/{kb}/rebuild`：手动重建指定知识库索引
- `POST /ingest`：Body `{ "kb": "kb_id", "rebuild": true }`，从该知识库对应的 RAW 目录重建索引
- `POST /ask`：Body `{ "kb": "kb_id", "question": "中文问题", "top_k": 6 }`，在指定知识库上进行 RAG 问答

示例
```bash
curl -s http://localhost:8000/health
curl -s -X POST http://localhost:8000/kb -H "Content-Type: application/json" -d '{"name":"计算机网络"}'
curl -s -X POST http://localhost:8000/ingest -H "Content-Type: application/json" -d '{"kb":"my_kb","rebuild":true}'
curl -s -X POST http://localhost:8000/ask -H "Content-Type: application/json" -d '{"kb":"my_kb","question":"什么是计算机网络？"}'
```

---

## 特性与实现要点

- 资料解析与切分：`SimpleDirectoryReader` + `SentenceSplitter(chunk_size=1000, overlap=120)`，保留 `source/page/timestamp` 元信息
- 向量化与索引：Qwen 1024 维嵌入 → FAISS（L2），索引持久化到 `INDEX_DIR`
- 检索与拼接：Top‑K（默认 6），按 ~2500 tokens 预算裁剪上下文并编号 `[1][2]…`
- 生成策略：DeepSeek 低温度中文回答，仅依据上下文；不足即明确说明找不到
- 跨平台稳健：相对路径自动锚定到 backend；索引加载支持 FAISS 直读与 LlamaIndex 存储

## 目录结构（多知识库）
```
backend/
  app/
    api/            # /health, /kb, /ingest, /ask
    core/           # settings, embed(qwen), index, retriever, rag, generator
    models/         # Pydantic 请求/响应
  data/
    raw/            # 原始资料根目录（按知识库划分子目录 raw/<kb_id>/）
    index/          # FAISS 索引根目录（按知识库划分子目录 index/<kb_id>/）
    # raw/_kb_meta.json  # 知识库元数据：ID -> 中文名称等
frontend/
  vite-react/       # 前端工程
```

---

## 常见问题（Troubleshooting）

- 400 无法加载索引：确认指定 `kb_id` 已完成构建（先执行 `POST /ingest` 带 `{"kb":"kb_id","rebuild":true}`，或在 backend 目录下运行 `python build_index.py --kb kb_id --rebuild`，并检查 `backend/data/index/kb_id` 非空）
- 400 DEEPSEEK_API_KEY 未配置或无效：在 `backend/.env` 写入真实密钥并重启后端
- 502 DeepSeek 请求失败：检查网络/代理、`DEEPSEEK_BASE_URL` 与 Key 权限
- 400 RAW_DIR 中没有可用资料：确认 `backend/data/raw` 下存在 `.pdf/.pptx/.md`
- 维度报错：嵌入维度已固定为 1024，如出现不一致请升级 DashScope SDK 并重建索引

---

保持简单、可复用与中文友好。如果你需要 Docker/部署说明或无 LLM 降级模式，欢迎提 Issue 补充。
