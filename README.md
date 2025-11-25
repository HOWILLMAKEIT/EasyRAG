<div align="center">
  <img src="assert/image.png" alt="EasyRAG Logo" width="140" />
  <p style="margin-top: 0.8em;">通用中文 RAG 助手（示例语料：计算机网络课程）</p>
  <p>
    <img src="https://img.shields.io/badge/Python-3.11%2B-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python 3.11+" />
    <img src="https://img.shields.io/badge/Backend-FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="Backend: FastAPI" />
    <img src="https://img.shields.io/badge/RAG-LlamaIndex-FF9800?style=for-the-badge" alt="LlamaIndex" />
    <img src="https://img.shields.io/badge/Embedding-Qwen%20v4%20(1024d)-4CAF50?style=for-the-badge" alt="Qwen 1024d" />
    <img src="https://img.shields.io/badge/Vector%20Store-FAISS-607D8B?style=for-the-badge" alt="FAISS" />
    <img src="https://img.shields.io/badge/LLM-DeepSeek--chat-E91E63?style=for-the-badge" alt="DeepSeek: deepseek-chat" />
    <img src="https://img.shields.io/badge/Frontend-Vite%20%2B%20React-3F51B5?style=for-the-badge&logo=react&logoColor=white" alt="Vite + React" />
  </p>
</div>

一个轻量、可复用的中文 RAG 助手（默认示例面向“计算机网络”课程，但可替换为任意自有语料）：
- 后端：FastAPI + LlamaIndex + FAISS
- 嵌入：通义千问 Qwen（DashScope，text-embedding-v4，固定 1024 维）
- 生成：DeepSeek-V3.2-Exp 的非思考模式
- 前端：Vite + React（TS），提供 Ingest/Ask 两个页面

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

3) 准备课程资料并构建索引
```bash
# 将 .pdf/.pptx/.md 放到 backend/data/raw/
cd backend
python build_index.py --rebuild
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

- `POST /ingest`
  - Body: `{ "rebuild": true }`
  - 用于读取 `RAW_DIR` 并构建/重建索引

- `POST /ask`
  - Body: `{ "question": "中文问题", "top_k": 6 }`
  - 返回：`{ answer, contexts[], latency_ms }`

- `GET /health`
  - 存活检查

示例
```bash
curl -s http://localhost:8000/health
curl -s -X POST http://localhost:8000/ingest -H "Content-Type: application/json" -d '{"rebuild": true}'
curl -s -X POST http://localhost:8000/ask -H "Content-Type: application/json" -d '{"question":"什么是计算机网络？"}'
```

---

## 特性与实现要点

- 资料解析与切分：`SimpleDirectoryReader` + `SentenceSplitter(chunk_size=1000, overlap=120)`，保留 `source/page/timestamp` 元信息
- 向量化与索引：Qwen 1024 维嵌入 → FAISS（L2），索引持久化到 `INDEX_DIR`
- 检索与拼接：Top‑K（默认 6），按 ~2500 tokens 预算裁剪上下文并编号 `[1][2]…`
- 生成策略：DeepSeek 低温度中文回答，仅依据上下文；不足即明确说明找不到
- 跨平台稳健：相对路径自动锚定到 backend；索引加载支持 FAISS 直读与 LlamaIndex 存储

## 目录结构
```
backend/
  app/
    api/            # /ingest, /ask, /health
    core/           # settings, embed(qwen), index, retriever, rag, generator
    models/         # Pydantic 请求/响应
  data/
    raw/            # 原始资料（pdf/pptx/md）
    index/          # FAISS 持久化索引
frontend/
  vite-react/       # 前端工程
```

---

## 常见问题（Troubleshooting）

- 400 无法加载索引：先执行 `/ingest` 或 `python build_index.py --rebuild`，确认 `backend/data/index` 非空
- 400 DEEPSEEK_API_KEY 未配置或无效：在 `backend/.env` 写入真实密钥并重启后端
- 502 DeepSeek 请求失败：检查网络/代理、`DEEPSEEK_BASE_URL` 与 Key 权限
- 400 RAW_DIR 中没有可用资料：确认 `backend/data/raw` 下存在 `.pdf/.pptx/.md`
- 维度报错：嵌入维度已固定为 1024，如出现不一致请升级 DashScope SDK 并重建索引

---

保持简单、可复用与中文友好。如果你需要 Docker/部署说明或无 LLM 降级模式，欢迎提 Issue 补充。
