import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import {
  Bot,
  Brain,
  CheckCircle2,
  ChevronLeft,
  Edit3,
  Image,
  Loader2,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Settings,
  Trash2,
  User,
  X,
} from "lucide-react";
import remarkGfm from "remark-gfm";
import "./styles.css";

type Role = "user" | "assistant";
type MessageStatus = "done" | "streaming" | "error";

type ChatImage = {
  id: string;
  url: string;
  alt: string;
};

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  images: ChatImage[];
  createdAt: string;
  status: MessageStatus;
};

type ChatThread = {
  id: string;
  codexThreadId: string | null;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

type ModelOption = {
  id?: string;
  model?: string;
  displayName?: string;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: Array<string | { reasoningEffort?: string; effort?: string }>;
  inputModalities?: string[];
  isDefault?: boolean;
};

type SettingsState = {
  model: string;
  effort: string;
  cwd: string;
  systemPrompt: string;
};

type StreamEvent =
  | { type: "thread"; codexThreadId: string }
  | { type: "delta"; text: string }
  | { type: "final"; text: string }
  | { type: "image"; image: { url: string; alt?: string } }
  | { type: "done" }
  | { type: "error"; message: string };

const threadsKey = "hypardashboard.chat-app.threads.v1";
const settingsKey = "hypardashboard.chat-app.settings.v1";

const defaultSystemPrompt = [
  "You are a thinking partner for brainstorming and wall-bouncing.",
  "Help the user clarify intent, generate options, pressure-test assumptions, and turn vague ideas into concrete next moves.",
  "Keep responses compact but useful. Ask a question only when it unlocks better work.",
  "When a visual would help, describe the image you want generated and surface any generated image output cleanly.",
].join("\n");

const defaultSettings: SettingsState = {
  model: "gpt-5.5",
  effort: "medium",
  cwd: "",
  systemPrompt: defaultSystemPrompt,
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function createThread(): ChatThread {
  const now = nowIso();
  return {
    id: createId("thread"),
    codexThreadId: null,
    title: "New thread",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function loadThreads(): ChatThread[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(threadsKey) ?? "[]") as ChatThread[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [createThread()];
  } catch {
    return [createThread()];
  }
}

function loadSettings(): SettingsState {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(settingsKey) ?? "{}") };
  } catch {
    return defaultSettings;
  }
}

function titleFrom(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 48) || "Untitled thread";
}

function buildPriorTranscript(messages: ChatMessage[]) {
  return messages
    .filter((message) => message.content.trim())
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}:\n${message.content.trim()}`)
    .join("\n\n");
}

function App() {
  const [threads, setThreads] = useState(loadThreads);
  const [activeThreadId, setActiveThreadId] = useState(() => threads[0].id);
  const [settings, setSettings] = useState(loadSettings);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [serverStatus, setServerStatus] = useState("Connecting");
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? threads[0],
    [activeThreadId, threads],
  );

  const selectedModel = useMemo(
    () => models.find((model) => (model.model ?? model.id) === settings.model),
    [models, settings.model],
  );

  const effortOptions = useMemo(() => {
    const options = selectedModel?.supportedReasoningEfforts
      ?.map((effort) => typeof effort === "string" ? effort : effort.reasoningEffort ?? effort.effort)
      .filter((effort): effort is string => Boolean(effort));
    return options && options.length > 0 ? options : ["minimal", "low", "medium", "high", "xhigh"];
  }, [selectedModel]);

  useEffect(() => {
    localStorage.setItem(threadsKey, JSON.stringify(threads));
  }, [threads]);

  useEffect(() => {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [activeThread?.messages.length, activeThreadId]);

  useEffect(() => {
    void refreshModels();
  }, []);

  async function refreshModels() {
    try {
      const response = await fetch("/api/models");
      if (!response.ok) {
        throw new Error(`model/list returned ${response.status}`);
      }
      const data = await response.json() as { data?: ModelOption[] };
      const nextModels = data.data ?? [];
      setModels(nextModels);
      setServerStatus("Connected");

      const defaultModel = nextModels.find((model) => model.isDefault) ?? nextModels[0];
      const modelId = defaultModel?.model ?? defaultModel?.id;
      if (modelId && !nextModels.some((model) => (model.model ?? model.id) === settings.model)) {
        setSettings((current) => ({
          ...current,
          model: modelId,
          effort: defaultModel.defaultReasoningEffort ?? current.effort,
        }));
      }
    } catch (error) {
      setServerStatus(error instanceof Error ? error.message : "Disconnected");
    }
  }

  function updateActiveThread(updater: (thread: ChatThread) => ChatThread) {
    setThreads((current) => current.map((thread) => thread.id === activeThread.id ? updater(thread) : thread));
  }

  function handleNewThread() {
    const thread = createThread();
    setThreads((current) => [thread, ...current]);
    setActiveThreadId(thread.id);
    setDraft("");
  }

  function handleDeleteThread(threadId: string) {
    setThreads((current) => {
      const remaining = current.filter((thread) => thread.id !== threadId);
      const next = remaining.length > 0 ? remaining : [createThread()];
      if (threadId === activeThreadId) {
        setActiveThreadId(next[0].id);
      }
      return next;
    });
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text || isSending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: createId("message"),
      role: "user",
      content: text,
      images: [],
      createdAt: nowIso(),
      status: "done",
    };
    const assistantMessage: ChatMessage = {
      id: createId("message"),
      role: "assistant",
      content: "",
      images: [],
      createdAt: nowIso(),
      status: "streaming",
    };

    const threadAtSend = activeThread;
    setDraft("");
    setIsSending(true);
    updateActiveThread((thread) => ({
      ...thread,
      title: thread.messages.length === 0 ? titleFrom(text) : thread.title,
      messages: [...thread.messages, userMessage, assistantMessage],
      updatedAt: nowIso(),
    }));

    await runTurn({
      assistantMessageId: assistantMessage.id,
      codexThreadId: threadAtSend.codexThreadId,
      text,
    });
  }

  async function handleResendEditedMessage(messageId: string) {
    const text = editingDraft.trim();
    if (!text || isSending) {
      return;
    }

    const targetIndex = activeThread.messages.findIndex((message) => message.id === messageId && message.role === "user");
    if (targetIndex < 0) {
      return;
    }

    const previousMessages = activeThread.messages.slice(0, targetIndex);
    const originalUserMessage = activeThread.messages[targetIndex];
    const editedUserMessage: ChatMessage = {
      ...originalUserMessage,
      content: text,
      images: [],
      status: "done",
    };
    const assistantMessage: ChatMessage = {
      id: createId("message"),
      role: "assistant",
      content: "",
      images: [],
      createdAt: nowIso(),
      status: "streaming",
    };

    const priorTranscript = buildPriorTranscript(previousMessages);
    setEditingMessageId(null);
    setEditingDraft("");
    setIsSending(true);
    updateActiveThread((thread) => ({
      ...thread,
      codexThreadId: null,
      title: targetIndex === 0 ? titleFrom(text) : thread.title,
      messages: [...previousMessages, editedUserMessage, assistantMessage],
      updatedAt: nowIso(),
    }));

    await runTurn({
      assistantMessageId: assistantMessage.id,
      codexThreadId: null,
      priorTranscript,
      text,
    });
  }

  async function runTurn({
    assistantMessageId,
    codexThreadId,
    priorTranscript,
    text,
  }: {
    assistantMessageId: string;
    codexThreadId: string | null;
    priorTranscript?: string;
    text: string;
  }) {
    try {
      const response = await fetch("/api/chat/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          codexThreadId,
          priorTranscript,
          model: settings.model,
          effort: settings.effort,
          cwd: settings.cwd.trim() || undefined,
          systemPrompt: settings.systemPrompt,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Turn request returned ${response.status}`);
      }

      await consumeNdjson(response.body, (event) => {
        if (event.type === "thread") {
          updateActiveThread((thread) => ({ ...thread, codexThreadId: event.codexThreadId }));
          return;
        }

        if (event.type === "delta") {
          updateAssistant(assistantMessageId, (message) => ({ ...message, content: message.content + event.text }));
          return;
        }

        if (event.type === "final") {
          updateAssistant(assistantMessageId, (message) => ({ ...message, content: event.text }));
          return;
        }

        if (event.type === "image") {
          updateAssistant(assistantMessageId, (message) => ({
            ...message,
            images: [...message.images, {
              id: createId("image"),
              url: event.image.url,
              alt: event.image.alt ?? "Generated image",
            }],
          }));
          return;
        }

        if (event.type === "error") {
          updateAssistant(assistantMessageId, (message) => ({
            ...message,
            content: event.message,
            status: "error",
          }));
        }
      });

      updateAssistant(assistantMessageId, (message) => ({
        ...message,
        content: message.content || "No text response.",
        status: message.status === "error" ? "error" : "done",
      }));
    } catch (error) {
      updateAssistant(assistantMessageId, (message) => ({
        ...message,
        content: error instanceof Error ? error.message : "Turn failed.",
        status: "error",
      }));
    } finally {
      setIsSending(false);
    }
  }

  function updateAssistant(messageId: string, updater: (message: ChatMessage) => ChatMessage) {
    updateActiveThread((thread) => ({
      ...thread,
      messages: thread.messages.map((message) => message.id === messageId ? updater(message) : message),
      updatedAt: nowIso(),
    }));
  }

  return (
    <main className={`chat-shell ${sidebarOpen ? "" : "sidebar-hidden"}`}>
      <aside className="thread-sidebar" aria-label="Threads">
        <div className="sidebar-actions">
          <button className="primary-button" type="button" onClick={handleNewThread}>
            <MessageSquarePlus size={18} />
            New thread
          </button>
          <button className="icon-button" type="button" onClick={() => setSidebarOpen(false)} aria-label="Hide thread list">
            <PanelLeftClose size={18} />
          </button>
        </div>

        <nav className="thread-list">
          {threads.map((thread) => (
            <button
              className={`thread-item ${thread.id === activeThread.id ? "active" : ""}`}
              key={thread.id}
              type="button"
              onClick={() => setActiveThreadId(thread.id)}
            >
              <span>{thread.title}</span>
              <small>{thread.messages.length} messages</small>
            </button>
          ))}
        </nav>
      </aside>

      <section className="chat-panel">
        <header className="chat-header">
          <div className="title-row">
            {!sidebarOpen && (
              <button className="icon-button" type="button" onClick={() => setSidebarOpen(true)} aria-label="Show thread list">
                <PanelLeftOpen size={18} />
              </button>
            )}
            <div>
              <p className="eyebrow">Codex App Server chat</p>
              <h1>{activeThread.title}</h1>
            </div>
          </div>

          <div className="toolbar">
            <div className="status-chip">
              <CheckCircle2 size={15} />
              <span>{serverStatus}</span>
            </div>
            <div className="model-chip">
              <Brain size={15} />
              <span>{settings.model}</span>
              <strong>{settings.effort}</strong>
            </div>
            <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="Open settings">
              <Settings size={18} />
            </button>
            <button className="icon-button danger" type="button" onClick={() => handleDeleteThread(activeThread.id)} aria-label="Delete thread">
              <Trash2 size={18} />
            </button>
          </div>
        </header>

        <div className="messages" ref={scrollerRef}>
          {activeThread.messages.length === 0 ? (
            <section className="empty-state">
              <Bot size={36} />
              <h2>Start with a rough idea.</h2>
              <p>Each local thread maps to its own Codex App Server thread, so context stays separated while the conversation is saved in this browser.</p>
            </section>
          ) : (
            activeThread.messages.map((message) => (
              <MessageBubble
                editingDraft={editingDraft}
                isEditing={message.id === editingMessageId}
                isSending={isSending}
                key={message.id}
                message={message}
                onCancelEdit={() => {
                  setEditingMessageId(null);
                  setEditingDraft("");
                }}
                onChangeEdit={setEditingDraft}
                onResendEdit={() => void handleResendEditedMessage(message.id)}
                onStartEdit={() => {
                  setEditingMessageId(message.id);
                  setEditingDraft(message.content);
                }}
              />
            ))
          )}
        </div>

        <footer className="composer">
          <textarea
            aria-label="Message"
            placeholder="Ask for angles, names, counterarguments, a plan, or an image idea..."
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void handleSend();
              }
            }}
          />
          <button className="send-button" type="button" disabled={isSending || !draft.trim()} onClick={() => void handleSend()}>
            {isSending ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
            Send
          </button>
        </footer>
      </section>

      {settingsOpen && (
        <SettingsPanel
          effortOptions={effortOptions}
          models={models}
          settings={settings}
          onChange={setSettings}
          onClose={() => setSettingsOpen(false)}
          onRefreshModels={refreshModels}
        />
      )}
    </main>
  );
}

function MessageBubble({
  editingDraft,
  isEditing,
  isSending,
  message,
  onCancelEdit,
  onChangeEdit,
  onResendEdit,
  onStartEdit,
}: {
  editingDraft: string;
  isEditing: boolean;
  isSending: boolean;
  message: ChatMessage;
  onCancelEdit: () => void;
  onChangeEdit: (value: string) => void;
  onResendEdit: () => void;
  onStartEdit: () => void;
}) {
  return (
    <article className={`message ${message.role} ${message.status}`}>
      <div className="avatar" aria-hidden="true">
        {message.role === "user" ? <User size={18} /> : <Bot size={18} />}
      </div>
      <div className="message-content">
        <div className="message-meta">
          <strong>{message.role === "user" ? "You" : "Codex"}</strong>
          <div className="message-meta-actions">
            <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
            {message.role === "user" && message.status === "done" && (
              <button className="mini-action" disabled={isSending} type="button" onClick={onStartEdit} aria-label="Edit message">
                <Edit3 size={14} />
              </button>
            )}
          </div>
        </div>
        {isEditing ? (
          <div className="edit-box">
            <textarea
              aria-label="Edit user message"
              value={editingDraft}
              onChange={(event) => onChangeEdit(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  onResendEdit();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelEdit();
                }
              }}
            />
            <div className="edit-actions">
              <button className="secondary-button compact" type="button" onClick={onCancelEdit}>
                <X size={15} />
                Cancel
              </button>
              <button className="send-button compact" disabled={isSending || !editingDraft.trim()} type="button" onClick={onResendEdit}>
                {isSending ? <Loader2 className="spin" size={15} /> : <Send size={15} />}
                Resend
              </button>
            </div>
          </div>
        ) : message.status === "streaming" && !message.content ? (
          <p className="thinking"><Loader2 className="spin" size={16} /> Waiting for streamed Codex output...</p>
        ) : message.role === "assistant" ? (
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        ) : (
          <p>{message.content}</p>
        )}
        {message.images.length > 0 && (
          <div className="image-grid">
            {message.images.map((image) => (
              <a href={image.url} key={image.id} target="_blank" rel="noreferrer">
                <img alt={image.alt} src={image.url} />
                <span><Image size={14} /> Preview</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function SettingsPanel({
  effortOptions,
  models,
  settings,
  onChange,
  onClose,
  onRefreshModels,
}: {
  effortOptions: string[];
  models: ModelOption[];
  settings: SettingsState;
  onChange: (settings: SettingsState) => void;
  onClose: () => void;
  onRefreshModels: () => Promise<void>;
}) {
  return (
    <div className="settings-backdrop">
      <section className="settings-panel" role="dialog" aria-modal="true" aria-label="Chat settings">
        <header>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close settings">
            <ChevronLeft size={18} />
          </button>
          <h2>Codex settings</h2>
        </header>

        <label className="field">
          <span>Model</span>
          <select value={settings.model} onChange={(event) => onChange({ ...settings, model: event.target.value })}>
            {(models.length > 0 ? models : [{ model: settings.model, displayName: settings.model }]).map((model) => {
              const value = model.model ?? model.id ?? "";
              return <option key={value} value={value}>{model.displayName ?? value}</option>;
            })}
          </select>
        </label>

        <label className="field">
          <span>Reasoning effort</span>
          <select value={settings.effort} onChange={(event) => onChange({ ...settings, effort: event.target.value })}>
            {effortOptions.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
          </select>
        </label>

        <label className="field">
          <span>Working directory</span>
          <input
            value={settings.cwd}
            placeholder="Optional absolute path"
            onChange={(event) => onChange({ ...settings, cwd: event.target.value })}
          />
        </label>

        <label className="field">
          <span>Brainstorming system prompt</span>
          <textarea
            rows={10}
            value={settings.systemPrompt}
            onChange={(event) => onChange({ ...settings, systemPrompt: event.target.value })}
          />
        </label>

        <button className="secondary-button" type="button" onClick={() => void onRefreshModels()}>
          Refresh models
        </button>
      </section>
    </div>
  );
}

async function consumeNdjson(stream: ReadableStream<Uint8Array>, onEvent: (event: StreamEvent) => void) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) {
        onEvent(JSON.parse(line) as StreamEvent);
      }
    }
  }

  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as StreamEvent);
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
