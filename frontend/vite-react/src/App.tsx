import { useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

type ContextChunk = {
  source: string;
  page?: string | null;
  text: string;
};

type AskResult = {
  answer: string;
  contexts: ContextChunk[];
  latency_ms: number;
};

function App() {
  const [activeTab, setActiveTab] = useState<"ingest" | "ask">("ingest");

  // 上传相关状态
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [rebuild, setRebuild] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  // 问答相关状态
  const [question, setQuestion] = useState("");
  const [topK, setTopK] = useState(6);
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [contexts, setContexts] = useState<ContextChunk[]>([]);
  const [latency, setLatency] = useState<number | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const newFiles = Array.from(event.target.files);
      // 累积添加文件，避免重复
      setSelectedFiles((prev) => {
        const existingNames = new Set(prev.map(f => f.name));
        const uniqueNewFiles = newFiles.filter(f => !existingNames.has(f.name));
        return [...prev, ...uniqueNewFiles];
      });
      setUploadError(null);
      setUploadSuccess(null);
      // 重置文件输入框，允许重复选择同一个文件
      event.target.value = "";
    }
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleClearFiles = () => {
    setSelectedFiles([]);
    setUploadError(null);
    setUploadSuccess(null);
  };

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    
    if (selectedFiles.length === 0) {
      setUploadError("请选择要上传的文件");
      return;
    }

    setUploadLoading(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const formData = new FormData();
      selectedFiles.forEach((file) => {
        formData.append("files", file);
      });
      formData.append("rebuild", String(rebuild));

      const response = await fetch(`${API_BASE}/ingest/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail ?? response.statusText);
      }

      const data = await response.json();
      setUploadSuccess(`索引构建完成：${data.files} 个文件，${data.chunks} 个切片`);
      setSelectedFiles([]);
      // 重置文件选择器
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (fileInput) fileInput.value = "";
    } catch (error) {
      const message = error instanceof Error ? error.message : "上传失败";
      setUploadError(message);
    } finally {
      setUploadLoading(false);
    }
  };

  const submitQuestion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      setAskError("请先输入问题");
      return;
    }
    setAskLoading(true);
    setAskError(null);
    setAnswer("");
    setContexts([]);
    setLatency(null);

    try {
      const payload = { question: trimmedQuestion, top_k: topK };
      const response = await fetch(`${API_BASE}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail ?? response.statusText);
      }

      const data = (await response.json()) as AskResult;
      setAnswer(data.answer);
      setContexts(data.contexts);
      setLatency(data.latency_ms);
    } catch (error) {
      const message = error instanceof Error ? error.message : "问答失败";
      setAskError(message);
    } finally {
      setAskLoading(false);
    }
  };

  return (
    <div className="app">
      <header>
        <div>
          <p className="eyebrow">RAG · 计算机网络课程</p>
          <h1>netMind 智能问答助手</h1>
          <p className="subtitle">在线上传文档构建索引，智能问答随时体验。</p>
        </div>
        <nav className="tab-bar">
          <button className={activeTab === "ingest" ? "active" : ""} onClick={() => setActiveTab("ingest")}>
            Ingest 数据
          </button>
          <button className={activeTab === "ask" ? "active" : ""} onClick={() => setActiveTab("ask")}>
            Ask 问答
          </button>
        </nav>
      </header>

      {activeTab === "ingest" && (
        <section className="panel">
          <h2>上传文档构建索引</h2>
          <form onSubmit={handleUpload} className="form">
            <div className="field">
              <span>选择文件（支持 PDF / PPTX / Markdown）：</span>
              <div className="file-upload-wrapper">
                <input
                  type="file"
                  id="file-input"
                  multiple
                  accept=".pdf,.pptx,.md"
                  onChange={handleFileChange}
                  disabled={uploadLoading}
                />
                <label 
                  htmlFor="file-input" 
                  className={`file-upload-label ${uploadLoading ? 'disabled' : ''}`}
                >
                  <div className="file-upload-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <span>
                    {selectedFiles.length > 0 
                      ? `已选择 ${selectedFiles.length} 个文件` 
                      : '点击或拖拽文件到此处上传'}
                  </span>
                </label>
              </div>
            </div>
            {selectedFiles.length > 0 && (
              <div className="file-list">
                <div className="file-list-header">
                  <p>已选择 {selectedFiles.length} 个文件：</p>
                  <button 
                    type="button"
                    className="clear-files-btn"
                    onClick={handleClearFiles}
                    disabled={uploadLoading}
                  >
                    清空全部
                  </button>
                </div>
                <ul>
                  {selectedFiles.map((file, index) => (
                    <li key={index}>
                      <span className="file-info">
                        {file.name} ({Math.round(file.size / 1024)} KB)
                      </span>
                      <button
                        type="button"
                        className="remove-file-btn"
                        onClick={() => handleRemoveFile(index)}
                        disabled={uploadLoading}
                        title="移除此文件"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <label className="field-inline">
              <input
                type="checkbox"
                checked={rebuild}
                onChange={(e) => setRebuild(e.target.checked)}
                disabled={uploadLoading}
              />
              <span>清空旧索引重建（Rebuild）</span>
            </label>
            <button 
              type="submit" 
              disabled={uploadLoading || selectedFiles.length === 0}
              className={uploadLoading ? "loading" : ""}
            >
              {uploadLoading ? "处理中，请稍候..." : selectedFiles.length > 0 ? `🚀 上传并构建索引 (${selectedFiles.length} 个文件)` : "📤 上传并构建索引"}
            </button>
          </form>
          {uploadError && <p className="error">{uploadError}</p>}
          {uploadSuccess && <p className="success">{uploadSuccess}</p>}
          
          <div className="hint-box">
            <h3>命令行方式（备选）</h3>
            <p>也可以将文档放入 <code>backend/data/raw/</code>，然后在终端运行：</p>
            <pre>cd backend{"\n"}python build_index.py --rebuild</pre>
          </div>
        </section>
      )}

      {activeTab === "ask" && (
        <section className="panel">
          <form onSubmit={submitQuestion} className="form">
            <label className="field">
              <span>问题（中文）：</span>
              <textarea
                rows={4}
                placeholder="例如：TCP 三次握手的目的是什么？"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
              />
            </label>
            <label className="field-inline">
              <span>Top-K：</span>
              <input
                type="number"
                min={1}
                max={10}
                value={topK}
                onChange={(event) => setTopK(Number(event.target.value))}
              />
            </label>
            <button type="submit" disabled={askLoading}>
              {askLoading ? "检索生成中…" : "发送问题"}
            </button>
          </form>
          {askError && <p className="error">{askError}</p>}
          {answer && (
            <div className="answer-card">
              <div className="answer-header">
                <h2>答案</h2>
                {latency !== null && <span>耗时：{latency} ms</span>}
              </div>
              <p className="answer-text">{answer}</p>
              <div className="contexts">
                <h3>引用片段</h3>
                <ol>
                  {contexts.map((ctx, index) => (
                    <li key={`${ctx.source}-${index}`}>
                      <p className="context-source">
                        {ctx.source}
                        {ctx.page && <span> · {ctx.page}</span>}
                      </p>
                      <p>{ctx.text}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default App;
