import { useState, useRef, useEffect } from "react";
import { FaPaperPlane, FaDatabase, FaCog,FaUpload,FaTrash,FaFile,FaAngleDoubleLeft, FaAngleDoubleRight,FaPlusCircle,FaDownload,FaUserCircle} from "react-icons/fa";
import { v4 as uuidv4 } from 'uuid';
import "./App.css";

const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";
const DEFAULT_API_PORT = 8000;

type Message = {
  role: "user" | "ai";
  content: string;
  sources?: { ref?: number; source: string; page?: string; text?: string }[];
};

type ChatSession = {
  id: string;
  title: string;
};

type KnowledgeBase = {
  id: string;
  name: string;
  files: number;
};

type KnowledgeBaseFile = {
  name: string;
  size: number;
  modified_ts: number;
};

type DesktopConfig = {
  deepseekApiKey: string;
  qwenApiKey: string;
  kbRootPath: string;
  apiPort?: number;
};

type SearchInputProps = {
  value: string;
  onChange: (val: string) => void;
  onSend: () => void;
  loading: boolean;
};

const SearchInput = ({ value, onChange, onSend, loading }: SearchInputProps) => (
  <div className="input-capsule">
    <textarea
      rows={1}
      placeholder="例如：TCP 三次握手的目的是什么？"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      
      onInput={(e) => {
        const target = e.currentTarget;
        target.style.height = "auto"; 
        const newHeight = Math.min(target.scrollHeight, 120); 
        target.style.height = `${newHeight}px`;
      }}

      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onSend();
        }
      }}
    />
    <button className="send-btn" onClick={onSend} disabled={loading || !value}>
      {loading ? "..." : <FaPaperPlane />}
    </button>
  </div>
);


function App() {
  const [view, setView] = useState<"chat" | "ingest">("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [topK, setTopK] = useState(6);
  const [files, setFiles] = useState<File[]>([]);
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [ingestSuccess, setIngestSuccess] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]); 
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [activeKb, setActiveKb] = useState<string>("");
  const [kbFiles, setKbFiles] = useState<KnowledgeBaseFile[]>([]);
  const [kbLoading, setKbLoading] = useState(false);
  const [kbError, setKbError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [activeContext, setActiveContext] = useState<{ msgIndex: number; ref: number } | null>(null);
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [configOpen, setConfigOpen] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSuccess, setConfigSuccess] = useState<string | null>(null);
  const [configDraft, setConfigDraft] = useState<DesktopConfig>({
    deepseekApiKey: "",
    qwenApiKey: "",
    kbRootPath: "",
    apiPort: DEFAULT_API_PORT,
  });
  const isDesktop = typeof window !== "undefined" && !!window.desktopApi;
  const buildApiBase = (port?: number) => `http://127.0.0.1:${port ?? DEFAULT_API_PORT}`;
  const isConfigComplete = (cfg: DesktopConfig) =>
    Boolean(cfg.deepseekApiKey && cfg.qwenApiKey && cfg.kbRootPath);

  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    console.log("正在尝试读取本地会话列表...");
    const savedSessionsRaw = localStorage.getItem("chat_sessions");
    
    if (savedSessionsRaw) {
      console.log("找到了已保存的列表");
      try {
        const savedSessions = JSON.parse(savedSessionsRaw);
        if (Array.isArray(savedSessions)) { 
          setSessions(savedSessions); //显示在侧边栏
        }
      } catch (e) {
        console.error("读取会话列表失败:", e);
        localStorage.removeItem("chat_sessions");
      }
    } else {
      console.log("没有找到本地会话。");
    }
  }, []);

  useEffect(() => {
    if (!isDesktop || !window.desktopApi) {
      return;
    }
    const loadConfig = async () => {
      const cfg = await window.desktopApi!.getConfig();
      const merged: DesktopConfig = {
        deepseekApiKey: cfg.deepseekApiKey ?? "",
        qwenApiKey: cfg.qwenApiKey ?? "",
        kbRootPath: cfg.kbRootPath ?? "",
        apiPort: cfg.apiPort ?? DEFAULT_API_PORT,
      };
      setConfigDraft(merged);
      setApiBase(buildApiBase(merged.apiPort));
      setConfigOpen(!isConfigComplete(merged));
    };
    loadConfig();
  }, [isDesktop]);

  const formatSourceLabel = (s: { ref?: number; source: string; page?: string; text?: string }, idx: number) => {
    const ref = s.ref !== undefined && s.ref !== null && s.ref > 0 ? s.ref : idx + 1;
    const base = s.source || "未知来源";
    // 只显示编号 + 文件名，不再显示位置/片段信息
    return `[${ref}] ${base}`;
  };

  // 加载知识库列表
  const fetchKnowledgeBases = async (preferKb?: string) => {
    try {
      const res = await fetch(`${apiBase}/kb`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.items)) {
        setKnowledgeBases(data.items);
        const idToUse = preferKb || activeKb || (data.items[0]?.id ?? "");
        if (idToUse && idToUse !== activeKb) {
          setActiveKb(idToUse);
        }
      }
    } catch {
      // 忽略首页 KB 加载错误，仍可使用默认配置
    }
  };

  const fetchKbFiles = async (kbId: string) => {
    if (!kbId) {
      setKbFiles([]);
      return;
    }
    setKbLoading(true);
    setKbError(null);
    try {
      const res = await fetch(`${apiBase}/kb/${encodeURIComponent(kbId)}/files`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? res.statusText);
      }
      const data = await res.json();
      if (Array.isArray(data.files)) {
        setKbFiles(data.files);
      } else {
        setKbFiles([]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "加载知识库文件列表失败";
      setKbError(msg);
      setKbFiles([]);
    } finally {
      setKbLoading(false);
    }
  };

  useEffect(() => {
    fetchKnowledgeBases();
  }, [apiBase]);

  useEffect(() => {
    if (activeKb) {
      fetchKbFiles(activeKb);
    } else {
      setKbFiles([]);
    }
  }, [activeKb, apiBase]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setIngestError(null);
    setIngestSuccess(null);
    if (event.target.files) {
      const newFiles = Array.from(event.target.files);
      setFiles((prev) => {
        const existingNames = new Set(prev.map(f => f.name));
        const trulyNew = newFiles.filter(nf => !existingNames.has(nf.name));
        return [...prev, ...trulyNew];
      });
    }
  };

  const handleRemoveFile = (fileName: string) => {
    setFiles((prev) => prev.filter(f => f.name !== fileName));
  };

  const handleClearFiles = () => {
    setFiles([]);
    setIngestError(null);
    setIngestSuccess(null);
  };

  const handleOpenConfig = () => {
    setConfigError(null);
    setConfigSuccess(null);
    setConfigOpen(true);
  };

  const handleSelectKbRoot = async () => {
    if (!window.desktopApi) return;
    const selected = await window.desktopApi.selectKbRoot();
    if (selected) {
      setConfigDraft((prev) => ({ ...prev, kbRootPath: selected }));
    }
  };

  const handleSaveConfig = async () => {
    if (!window.desktopApi) return;
    setConfigError(null);
    setConfigSuccess(null);
    const nextConfig: DesktopConfig = {
      deepseekApiKey: configDraft.deepseekApiKey.trim(),
      qwenApiKey: configDraft.qwenApiKey.trim(),
      kbRootPath: configDraft.kbRootPath.trim(),
      apiPort: Number(configDraft.apiPort || DEFAULT_API_PORT),
    };
    if (!isConfigComplete(nextConfig)) {
      setConfigError("请填写完整配置");
      return;
    }
    if (!Number.isFinite(nextConfig.apiPort) || nextConfig.apiPort! <= 0 || nextConfig.apiPort! > 65535) {
      setConfigError("API 端口无效");
      return;
    }
    setConfigSaving(true);
    try {
      const saved = await window.desktopApi.saveConfig(nextConfig);
      const merged: DesktopConfig = {
        deepseekApiKey: saved.deepseekApiKey ?? "",
        qwenApiKey: saved.qwenApiKey ?? "",
        kbRootPath: saved.kbRootPath ?? "",
        apiPort: saved.apiPort ?? DEFAULT_API_PORT,
      };
      setConfigDraft(merged);
      setApiBase(buildApiBase(merged.apiPort));
      setConfigOpen(false);
      setConfigSuccess("配置已保存");
    } catch (e) {
      const message = e instanceof Error ? e.message : "保存配置失败";
      setConfigError(message);
    } finally {
      setConfigSaving(false);
    }
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      setIngestError("请至少选择一个文件");
      return;
    }




    setIngestLoading(true);
    setIngestError(null);
    setIngestSuccess(null);
    
    const formData = new FormData();
    files.forEach(file => {
      formData.append("files", file);
    });

    try {
      const kb = activeKb || "default";
      const res = await fetch(`${apiBase}/kb/${encodeURIComponent(kb)}/upload`, {
        method: "POST",
        body: formData,
      });
      
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? res.statusText);
      }

      const data = await res.json();
      setIngestSuccess(`成功索引 ${data.files} 个文档！`);
      setFiles([]); // 上传成功后清空列表
      // 上传成功后刷新知识库和文件信息
      fetchKnowledgeBases(kb);
      fetchKbFiles(kb);
    } catch (e) {
      const message = e instanceof Error ? e.message : "上传和索引失败，请检查后端服务";
      setIngestError(message);
    } finally {
      setIngestLoading(false);
    }
  };

const handleCreateKb = async () => { 
    const rawName = window.prompt("请输入新的知识库名称（字母、数字、-、_）");
    if (!rawName) return;
    const name = rawName.trim();
    if (!name) return;
    try {
      const res = await fetch(`${apiBase}/kb`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? res.statusText);
      }
      const kbInfo = await res.json();
      const newId = kbInfo.id as string;
      await fetchKnowledgeBases(newId);
      await fetchKbFiles(newId);
      setActiveKb(newId);
      setIngestSuccess(`知识库 ${kbInfo.name ?? name} 创建成功`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "创建知识库失败";
      setIngestError(msg);
    }
  };

const handleSelectKb = (name: string) => { 
  setActiveKb(name); 
}; 

  const handleDeleteKb = async () => {
    const kbId = activeKb;
    if (!kbId) {
      window.alert("当前没有选中的知识库。");
      return;
    }
    const kbLabel = knowledgeBases.find(kb => kb.id === kbId)?.name || kbId;
    const ok = window.confirm(
      `确认删除知识库 ${kbLabel} 吗？\n该操作会删除该知识库下的所有文件与索引，且不可恢复。`
    );
    if (!ok) return;

    try {
      const res = await fetch(`${apiBase}/kb/${encodeURIComponent(kbId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? res.statusText);
      }

      const remaining = knowledgeBases.filter(kb => kb.id !== kbId);
      const nextId = remaining[0]?.id ?? "";
      setKbFiles([]);
      setActiveKb(nextId);
      await fetchKnowledgeBases(nextId);
      setIngestSuccess(`知识库 ${kbLabel} 已删除`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "删除知识库失败";
      setIngestError(msg);
    }
  };

  const handleDeleteKbFile = async (fileName: string) => { 
    const kbId = activeKb || "default"; 
    const kbLabel = knowledgeBases.find(kb => kb.id === kbId)?.name || kbId; 
    const confirmDelete = window.confirm(
      `确认从知识库 ${kbLabel} 中删除文件：${fileName} 吗？（删除后系统会自动重建索引）`
    ); 
    if (!confirmDelete) return;
    try {
      const res = await fetch(`${apiBase}/kb/${encodeURIComponent(kbId)}/files`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: [fileName] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? res.statusText);
      }
      const data = await res.json(); 
      if (Array.isArray(data.files)) { 
        setKbFiles(data.files); 
        const extra =
          data.files.length > 0
            ? "，并已自动重建索引。"
            : "，该知识库已无文档，索引已清空。";
        setIngestSuccess(`已从知识库 ${kbLabel} 删除文件：${fileName}${extra}`);
      } 
    } catch (e) {
      const msg = e instanceof Error ? e.message : "删除文件失败";
      setIngestError(msg);
    }
  };

 const handleNewChat = () => {
    console.log("正在创建新会话");
    setMessages([]);
    setActiveSessionId(null);
    setView("chat");
  };

  const handleSelectSession = (sessionId: string) => {
    console.log(`正在加载会话: ${sessionId}`);
    setActiveSessionId(sessionId);
    setView("chat");
    const messageKey = "chat_messages_" + sessionId;
    
    //从localStorage读取会话的聊天记录
    const savedMessagesRaw = localStorage.getItem(messageKey);

    if (savedMessagesRaw) {
      console.log("找到了这个会话的聊天记录!");
      try {
        const savedMessages = JSON.parse(savedMessagesRaw);
        setMessages(savedMessages);
      } catch (e) {
        console.error("读取聊天记录失败:", e);
        setMessages([]); 
        localStorage.removeItem(messageKey); 
      }
    } else {
      console.warn("没有找到这个会话的聊天记录!");
      setMessages([]);
    }
  };
  const handleDeleteSession = (sessionIdToDelete: string) => {

    const newSessions = sessions.filter(session => session.id !== sessionIdToDelete);
    setSessions(newSessions);

    try {
      localStorage.setItem("chat_sessions", JSON.stringify(newSessions));
    } catch (e) {
      console.error("更新会话列表(localStorage)失败:", e);
    }
    
    try {
      const messageKey = "chat_messages_" + sessionIdToDelete;
      localStorage.removeItem(messageKey);
    } catch (e) {
      console.error("删除聊天记录(localStorage)失败:", e);
    }

    if (activeSessionId === sessionIdToDelete) {
      handleNewChat(); 
    }
  };
 const handleDownloadSession = (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;

    const key = "chat_messages_" + sessionId;
    const msgsRaw = localStorage.getItem(key);
    const messages = msgsRaw ? JSON.parse(msgsRaw) : [];

    const exportData = {
      id: session.id,
      title: session.title,
      timestamp: new Date().toISOString(),
      messages: messages
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    const safeTitle = session.title.slice(0, 15).replace(/[\\/:*?"<>|]/g, "_");
    a.download = `chat_${safeTitle}_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const handleSend = async () => {
    if (!inputValue.trim() || loading) return;

    const question = inputValue.trim();
    const userMessage: Message = { role: "user", content: question };
    
    setInputValue(""); 
    const textarea = document.querySelector(".input-capsule textarea") as HTMLTextAreaElement;
    if (textarea) { textarea.style.height = "auto"; }

    setMessages(prev => [...prev, userMessage]);
    setLoading(true);

    let currentSessionId = activeSessionId;
    let currentSessions = sessions; 

    if (currentSessionId === null) {
      
      currentSessionId = uuidv4(); 
      const newSession: ChatSession = { id: currentSessionId, title: question };
      
      setActiveSessionId(currentSessionId);
      currentSessions = [newSession, ...sessions];
      setSessions(currentSessions);

      try {
        localStorage.setItem("chat_sessions", JSON.stringify(currentSessions));
      } catch (e) {
        console.error("保存会话列表失败:", e);
      }
    }

    let aiMessage: Message = { role: "ai", content: "..." }; 
    try {
      const kb = activeKb || "default";
      const res = await fetch(`${apiBase}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          kb,
          question: question, 
          top_k: topK //
        })
      });
      
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `请求失败: ${res.statusText}`);
      }
      const data = await res.json();
      aiMessage = { role: "ai", content: data.answer, sources: data.contexts };

    } catch (e) {
      const message = e instanceof Error ? e.message : "抱歉，连接后端失败。";
      aiMessage = { role: "ai", content: message };
    } finally {
      setLoading(false);
      
      setMessages(prevMessages => {
        const updatedMessages = [...prevMessages, aiMessage];
        
        try {
          localStorage.setItem("chat_messages_" + currentSessionId, JSON.stringify(updatedMessages));
          console.log(`会话 ${currentSessionId} 已保存!`);
        } catch (e) {
          console.error("保存聊天记录失败:", e);
        }
        
        return updatedMessages;
      });
    }
  };

  const configRequired = isDesktop && !isConfigComplete(configDraft);

  //类名数组，用于管理侧边栏是否收起
const sidebarClasses = ["sidebar"];

if (isSidebarCollapsed) {
  sidebarClasses.push("collapsed");
}
  return (
    <div className="app-container">
      {isDesktop && (
        <button className="user-center-btn" onClick={handleOpenConfig} title="配置">
          <FaUserCircle />
        </button>
      )}
      <aside className={sidebarClasses.join(" ")}>
        <div className="sidebar-title">
          <span className="nav-text">EasyRAG 助手</span>
        </div>
        <button className="nav-btn new-chat-btn" onClick={handleNewChat}>
          <FaPlusCircle />
          <span className="nav-text">新建对话</span>
        </button>
        
        <div className="session-list">
          {sessions.map(session => (
            <button 
              key={session.id}
              className={`nav-btn session-item ${session.id === activeSessionId ? 'active' : ''}`}
              onClick={() => handleSelectSession(session.id)}
            >
              <span className="nav-text session-title-text">{session.title}</span>
              
              <span className="action-group">
                {/*下载按钮*/}
                <button 
                  className="action-btn download-btn"
                  onClick={(e) => {
                    e.stopPropagation(); 
                    handleDownloadSession(session.id);
                  }}
                  title="保存到本地"
                >
                  <FaDownload />
                </button>

                {/*删除按钮*/}
                <button 
                  className="action-btn delete-btn"
                  onClick={(e) => {
                    e.stopPropagation(); 
                    handleDeleteSession(session.id);
                  }}
                  title="删除"
                >
                  <FaTrash />
                </button>
              </span>
            </button>
          ))}
        </div>
  
        <button 
          className={`nav-btn ${view === 'ingest' ? 'active' : ''}`}
          onClick={() => setView('ingest')}
        >
          <FaDatabase /> 
          <span className="nav-text">知识库管理</span>
        </button>

        <div style={{flex: 1}}></div> 

        <div className="settings-block">
          <div className="sidebar-title" 
                onClick={() => 
                  {
                    if (isSidebarCollapsed) {
                      setIsSidebarCollapsed(false);
                    }
                  }
              } 
          style={{display:'flex', alignItems:'center'}}>
            
            <FaCog /> 
            <span className="nav-text" style={{marginLeft: 6}}>检索设置</span>
          </div>
        
          <div className="settings-content"> 
            <div style={{fontSize: '0.9rem', color: '#666', marginBottom: 8}}>
              <span className="nav-text">参考片段数 (Top-K): <strong>{topK}</strong></span>
            </div>
            <input 
              type="range" 
              min="1" 
              max="10" 
              step="1"
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
              style={{width: '100%', cursor: 'pointer', marginBottom: '15px'}} 
            />

            <div style={{borderTop: '1px dashed #e5e5e5', paddingTop: '10px'}}>
             
            </div>
          </div>
        </div>

        <button 
          className="nav-btn toggle-btn"
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        >
          {isSidebarCollapsed ? <FaAngleDoubleRight /> : <FaAngleDoubleLeft />}
          <span className="nav-text" style={{marginLeft: 8}}>收起侧边栏</span>
        </button>
        
      </aside>

      <main className="main-content">
       {view === 'ingest' && (
          
          <div className="ingest-panel">
            <h2 className="ingest-title">
              知识库管理
            </h2>
            
            <p className="ingest-subtitle">
              在这里上传、管理和索引你的课程文档（PDF, PPTX, MD）。
            </p>
            
            <div className="ingest-form">
              <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                <div> 
                  <span style={{ fontSize: '0.95rem', color: '#475569' }}>当前知识库：</span> 
                  <select 
                    value={activeKb} 
                    onChange={(e) => handleSelectKb(e.target.value)} 
                    style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #cbd5f5' }} 
                    disabled={ingestLoading} 
                  > 
                    {knowledgeBases.map(kb => ( 
                      <option key={kb.id} value={kb.id}> 
                        {kb.name}（{kb.files} 个文件） 
                      </option> 
                    ))} 
                    {knowledgeBases.length === 0 && <option value="">暂无知识库，请先创建</option>} 
                  </select> 
                </div> 
                <div style={{ display: 'flex', gap: 8 }}>
                  <button 
                    type="button" 
                    onClick={handleCreateKb} 
                    className="clear-btn" 
                    style={{ whiteSpace: 'nowrap' }} 
                    disabled={ingestLoading} 
                  > 
                    <FaPlusCircle /> 新建知识库 
                  </button> 
                  <button
                    type="button"
                    onClick={handleDeleteKb}
                    className="clear-btn"
                    style={{ whiteSpace: 'nowrap', color: '#dc2626', borderColor: '#fecaca' }}
                    disabled={ingestLoading || !activeKb}
                  >
                    <FaTrash /> 删除当前知识库
                  </button>
                </div>
              </div>
              <label className="file-drop-area">
                <input 
                  type="file" 
                  multiple 
                  onChange={handleFileChange} 
                  accept=".pdf,.pptx,.md" 
                  disabled={ingestLoading}
                />
                <FaUpload style={{fontSize: '1.5rem', color: '#64748b'}}/>
                <span className="file-drop-text">
                  点击选择文件，或拖拽到此处
                </span>
                <span className="file-drop-hint">
                  支持 PDF, PPTX, Markdown
                </span>
              </label>

              {files.length > 0 && (
                <div className="file-list-preview">
                  <div className="file-list-header">
                    <span>已选 {files.length} 个文件</span>
                    <button onClick={handleClearFiles} className="clear-btn" disabled={ingestLoading}>
                      <FaTrash /> 清空列表
                    </button>
                  </div>
                  <ul className="file-list">
                    {files.map(file => (
                      <li key={file.name} className="file-item">
                        <FaFile style={{color: '#94a3b8'}}/>
                        <span className="file-name">{file.name}</span>
                        <span className="file-size">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                        <button onClick={() => handleRemoveFile(file.name)} className="remove-btn" disabled={ingestLoading}>
                          &times;
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button 
                className="upload-btn" 
                onClick={handleUpload} 
                disabled={ingestLoading || files.length === 0}
              >
                {ingestLoading ? "索引中..." : `开始索引 ${files.length} 个文件`}
              </button>

              {ingestError && <p className="ingest-message error">{ingestError}</p>}
              {ingestSuccess && <p className="ingest-message success">{ingestSuccess}</p>}

              {/* 当前知识库中文件列表 */}
              <div style={{ marginTop: 24 }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 8 }}>当前知识库文件</h3>
                {kbLoading ? (
                  <p style={{ fontSize: '0.9rem', color: '#64748b' }}>加载中...</p>
                ) : kbError ? (
                  <p className="ingest-message error">{kbError}</p>
                ) : kbFiles.length === 0 ? (
                  <p style={{ fontSize: '0.9rem', color: '#94a3b8' }}>暂无文件，请先上传。</p>
                ) : (
                  <ul className="file-list">
                    {kbFiles.map(file => (
                      <li key={file.name} className="file-item">
                        <FaFile style={{ color: '#94a3b8' }} />
                        <span className="file-name">{file.name}</span>
                        <span className="file-size">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                        <button
                          onClick={() => handleDeleteKbFile(file.name)}
                          className="remove-btn"
                          disabled={ingestLoading}
                        >
                          <FaTrash />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        {view === 'chat' && (
          <>
         
            {messages.length === 0 ? (
              <div className="welcome-view">
                <div className="hero-text">
                  <p style={{color: '#2563eb', fontWeight: 'bold', marginBottom: 10}}>RAG · 通用中文知识库</p>
                  <h1>您今天想学习什么知识？</h1>
                  <p className="subtitle">我是 EasyRAG 智能助手，有什么可以帮你？</p>
                </div>
                
              </div>
            ) : (
              <div className="chat-view">
                {messages.map((msg, idx) => (
                  <div key={idx} className={`message-item ${msg.role}`}>
                    <div className="message-content">
                      <div className="msg-role-name">
                        {msg.role === 'ai' ? 'EasyRAG' : '你'}
                      </div>
                      <div style={{whiteSpace: 'pre-wrap'}}>{msg.content}</div>
                      {msg.sources && msg.sources.length > 0 && (
                        <div
                          style={{
                            marginTop: 10,
                            fontSize: "0.85rem",
                            color: "#555",
                            background: "rgba(0,0,0,0.05)",
                            padding: "6px 10px",
                            borderRadius: 6,
                            display: "block",
                          }}
                        >
                          <div style={{ marginBottom: 6 }}>📚 参考：</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {msg.sources
                              .slice()
                              .sort(
                                (a, b) => (a.ref ?? Number.MAX_SAFE_INTEGER) - (b.ref ?? Number.MAX_SAFE_INTEGER)
                              )
                              .map((s, sIdx) => {
                                const ref = s.ref ?? sIdx + 1;
                                const label = formatSourceLabel(s, sIdx);
                                const isActive =
                                  activeContext &&
                                  activeContext.msgIndex === idx &&
                                  activeContext.ref === ref;
                                return (
                                  <button
                                    key={`${ref}-${s.source}-${s.page ?? ""}`}
                                    type="button"
                                    onClick={() =>
                                      setActiveContext(
                                        isActive ? null : { msgIndex: idx, ref }
                                      )
                                    }
                                    style={{
                                      border: "none",
                                      borderRadius: 999,
                                      padding: "2px 8px",
                                      fontSize: "0.8rem",
                                      cursor: "pointer",
                                      backgroundColor: isActive ? "#2563eb" : "#e5e7eb",
                                      color: isActive ? "#fff" : "#374151",
                                    }}
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                          </div>
                          {activeContext &&
                            activeContext.msgIndex === idx && (
                              <div
                                style={{
                                  marginTop: 8,
                                  padding: "6px 8px",
                                  borderRadius: 4,
                                  backgroundColor: "#f9fafb",
                                  border: "1px solid #e5e7eb",
                                  fontSize: "0.8rem",
                                  maxHeight: 160,
                                  overflowY: "auto",
                                  whiteSpace: "pre-wrap",
                                }}
                              >
                                {(() => {
                                  const ctx = msg.sources!.find(
                                    (s, sIdx) =>
                                      (s.ref ?? sIdx + 1) === activeContext.ref
                                  );
                                  return ctx?.text || "暂无原文片段。";
                                })()}
                              </div>
                            )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}

           
            <div className={`input-area-wrapper ${messages.length > 0 ? "fixed-bottom" : ""}`}>
              <SearchInput 
                value={inputValue}
                onChange={setInputValue}
                onSend={handleSend}
                loading={loading}
              />
            </div>
          </>
        )}
      
      </main>

      {isDesktop && configOpen && (
        <div className="config-modal-backdrop">
          <div className="config-modal">
            <div className="config-modal-header">
              <h3>应用配置</h3>
              {!configRequired && (
                <button
                  type="button"
                  className="config-close"
                  onClick={() => setConfigOpen(false)}
                  aria-label="Close"
                >
                  ×
                </button>
              )}
            </div>
            <div className="config-field">
              <label>DeepSeek API Key</label>
              <input
                type="password"
                value={configDraft.deepseekApiKey}
                onChange={(e) =>
                  setConfigDraft((prev) => ({ ...prev, deepseekApiKey: e.target.value }))
                }
              />
            </div>
            <div className="config-field">
              <label>Qwen API Key</label>
              <input
                type="password"
                value={configDraft.qwenApiKey}
                onChange={(e) =>
                  setConfigDraft((prev) => ({ ...prev, qwenApiKey: e.target.value }))
                }
              />
            </div>
            <div className="config-field">
              <label>知识库根目录</label>
              <div className="config-row">
                <input
                  type="text"
                  value={configDraft.kbRootPath}
                  onChange={(e) =>
                    setConfigDraft((prev) => ({ ...prev, kbRootPath: e.target.value }))
                  }
                />
                <button type="button" onClick={handleSelectKbRoot}>
                  选择目录
                </button>
              </div>
            </div>
            <div className="config-field">
              <label>API 端口</label>
              <input
                type="number"
                min="1"
                max="65535"
                value={configDraft.apiPort ?? ""}
                onChange={(e) =>
                  setConfigDraft((prev) => ({
                    ...prev,
                    apiPort: e.target.value ? Number(e.target.value) : undefined,
                  }))
                }
              />
            </div>
            {configError && <p className="config-message error">{configError}</p>}
            {configSuccess && <p className="config-message success">{configSuccess}</p>}
            <div className="config-actions">
              {!configRequired && (
                <button
                  type="button"
                  className="config-btn secondary"
                  onClick={() => setConfigOpen(false)}
                  disabled={configSaving}
                >
                  取消
                </button>
              )}
              <button
                type="button"
                className="config-btn primary"
                onClick={handleSaveConfig}
                disabled={configSaving}
              >
                {configSaving ? "保存中..." : "保存配置"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
