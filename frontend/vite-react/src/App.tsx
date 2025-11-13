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

  const [question, setQuestion] = useState("");
  const [topK, setTopK] = useState(6);
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [contexts, setContexts] = useState<ContextChunk[]>([]);
  const [latency, setLatency] = useState<number | null>(null);

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
          <p className="subtitle">索引由命令行构建，前端仅提供问答功能。</p>
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
          <h2>索引构建说明</h2>
          <p>当前版本不提供在线上传。请按照以下步骤在命令行构建或重建索引：</p>
          <ol className="steps">
            <li>将课程 PDF / PPTX / Markdown 放入 <code>backend/data/raw/</code>。</li>
            <li>
              在终端运行：
              <pre>
                cd backend
                {"\n"}python build_index.py --rebuild
              </pre>
            </li>
            <li>等待命令输出“索引构建完成”后再回到此页面进行问答。</li>
          </ol>
          <p className="hint">索引构建耗时取决于文档数量。CLI 会输出中文日志与处理结果。</p>
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
