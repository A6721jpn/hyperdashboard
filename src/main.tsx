import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  ExternalLink,
  FileImage,
  Image,
  List,
  Logs,
  MessageSquare,
  Pin,
  Play,
  Plus,
  Presentation,
  RefreshCcw,
  Search,
  Settings,
  Square,
  Terminal,
  Trash2,
} from "lucide-react";
import "./styles.css";

type AppStatus = "Running" | "Starting" | "Stopped" | "Idle" | "Error";
type StatusClass = "running" | "starting" | "stopped" | "warning" | "error";
type AppIcon = "image" | "chat" | "slide";

type LocalApp = {
  id: string;
  title: string;
  description: string;
  category: string;
  status: AppStatus;
  statusClass: StatusClass;
  port: string;
  mode: string;
  url: string;
  command: string;
  path: string;
  health: string;
  healthCheckUrl: string;
  notes: string;
  iconClass: AppIcon;
  pid: number | null;
  managed: boolean;
  logs: string[];
};

type AppsResponse = {
  apps: LocalApp[];
};

const iconFor: Record<AppIcon, typeof Image> = {
  image: FileImage,
  chat: MessageSquare,
  slide: Presentation,
};

const statusRank: Record<AppStatus, number> = {
  Error: 0,
  Starting: 1,
  Running: 2,
  Idle: 3,
  Stopped: 4,
};

function App() {
  const [apps, setApps] = useState<LocalApp[]>([]);
  const [selectedApp, setSelectedApp] = useState("image");
  const [query, setQuery] = useState("");
  const [sortByStatus, setSortByStatus] = useState(false);
  const [logsPinned, setLogsPinned] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const selected = apps.find((app) => app.id === selectedApp) ?? apps[0];

  const visibleApps = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = normalized
      ? apps.filter((app) =>
          [app.title, app.description, app.mode, app.command, app.path].some((value) =>
            value.toLowerCase().includes(normalized),
          ),
        )
      : apps;

    if (!sortByStatus) {
      return filtered;
    }

    return [...filtered].sort((a, b) => statusRank[a.status] - statusRank[b.status] || a.title.localeCompare(b.title));
  }, [apps, query, sortByStatus]);

  const runningCount = useMemo(() => apps.filter((app) => app.status === "Running").length, [apps]);
  const errorCount = useMemo(() => apps.filter((app) => app.status === "Error").length, [apps]);
  const managedCount = useMemo(() => apps.filter((app) => app.managed).length, [apps]);

  async function refreshApps(options: { quiet?: boolean } = {}) {
    try {
      const response = await fetch("/api/apps", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Dashboard API returned ${response.status}`);
      }
      const data = (await response.json()) as AppsResponse;
      setApps(data.apps);
      setBanner(null);
      if (!data.apps.some((app) => app.id === selectedApp) && data.apps[0]) {
        setSelectedApp(data.apps[0].id);
      }
    } catch (error) {
      if (!options.quiet) {
        setBanner(error instanceof Error ? error.message : "Could not load dashboard state.");
      }
    }
  }

  async function runAction(action: "start" | "stop" | "restart", appId = selected?.id) {
    if (!appId) {
      return;
    }

    setBusyAction(`${action}:${appId}`);
    try {
      const response = await fetch(`/api/apps/${appId}/${action}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? `${action} failed`);
      }
      setApps(data.apps);
      setBanner(null);
    } catch (error) {
      setBanner(error instanceof Error ? error.message : `${action} failed`);
      await refreshApps({ quiet: true });
    } finally {
      setBusyAction(null);
    }
  }

  async function runAll(action: "start-all" | "stop-all") {
    setBusyAction(action);
    try {
      const response = await fetch(`/api/apps/${action}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? `${action} failed`);
      }
      setApps(data.apps);
      setBanner(null);
    } catch (error) {
      setBanner(error instanceof Error ? error.message : `${action} failed`);
      await refreshApps({ quiet: true });
    } finally {
      setBusyAction(null);
    }
  }

  async function openApp(app = selected) {
    if (!app) {
      return;
    }
    if (app.status !== "Running") {
      await runAction("start", app.id);
    }
    window.location.assign(app.url);
  }

  async function clearLogs() {
    if (!selected) {
      return;
    }
    const response = await fetch(`/api/apps/${selected.id}/logs`, { method: "DELETE" });
    if (response.ok) {
      const data = await response.json();
      setApps(data.apps);
    }
  }

  useEffect(() => {
    void refreshApps();
    const timer = window.setInterval(() => {
      void refreshApps({ quiet: true });
    }, 2500);
    return () => window.clearInterval(timer);
  }, []);

  if (!selected) {
    return (
      <main className="empty-state">
        <AlertCircle size={28} aria-hidden="true" />
        <h1>Hypardashboard</h1>
        <p>Waiting for the local controller API.</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <span className="brand-mark">HD</span>
          <div>
            <strong>Hypardashboard</strong>
            <span>Local app control</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Dashboard sections">
          <button className="nav-item active" type="button">
            <List className="nav-icon" size={18} aria-hidden="true" />
            Apps
          </button>
          <button className="nav-item" type="button">
            <Terminal className="nav-icon" size={18} aria-hidden="true" />
            Sessions
          </button>
          <button className="nav-item" type="button">
            <Logs className="nav-icon" size={18} aria-hidden="true" />
            Logs
          </button>
          <button className="nav-item" type="button">
            <Settings className="nav-icon" size={18} aria-hidden="true" />
            Settings
          </button>
        </nav>

        <section className="sidebar-panel" aria-label="Workspace status">
          <span className="eyebrow">Workspace</span>
          <strong>D:\github\hypardashboard</strong>
          <span className="muted">{apps.length} registered apps</span>
        </section>

        <section className="sidebar-panel compact" aria-label="Global controls">
          <button
            className="command-button primary"
            type="button"
            disabled={busyAction !== null}
            onClick={() => runAll("start-all")}
          >
            <Play size={16} aria-hidden="true" />
            Start All
          </button>
          <button className="command-button" type="button" disabled={busyAction !== null} onClick={() => runAll("stop-all")}>
            <Square size={16} aria-hidden="true" />
            Stop All
          </button>
        </section>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <span className="eyebrow">Dashboard</span>
            <h1>Apps</h1>
          </div>
          <div className="topbar-actions">
            <label className="search">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                placeholder="Search apps or commands"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button className="icon-button" type="button" aria-label="Refresh apps" title="Refresh" onClick={() => refreshApps()}>
              <RefreshCcw size={18} aria-hidden="true" />
            </button>
            <button className="icon-button" type="button" aria-label="Add app" title="Add app">
              <Plus size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        {banner ? (
          <div className="banner" role="status">
            <AlertCircle size={17} aria-hidden="true" />
            {banner}
          </div>
        ) : null}

        <section className="metrics" aria-label="Summary metrics">
          <article>
            <span className="metric-value">{runningCount}</span>
            <span className="metric-label">Running</span>
          </article>
          <article>
            <span className="metric-value">{apps.length}</span>
            <span className="metric-label">Registered</span>
          </article>
          <article>
            <span className="metric-value">{managedCount}</span>
            <span className="metric-label">Managed here</span>
          </article>
          <article>
            <span className="metric-value">{errorCount}</span>
            <span className="metric-label">Blocking errors</span>
          </article>
        </section>

        <section className="workbench">
          <div className="app-table-panel" aria-label="Registered apps">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Control Surface</span>
                <h2>Registered Apps</h2>
              </div>
              <button className="quiet-button" type="button" onClick={() => setSortByStatus((value) => !value)}>
                {sortByStatus ? "Original order" : "Sort by status"}
              </button>
            </div>

            <div className="table" role="table" aria-label="Local apps">
              <div className="table-row table-head" role="row">
                <span role="columnheader">App</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Port</span>
                <span role="columnheader">Mode</span>
                <span role="columnheader">Controls</span>
              </div>

              {visibleApps.map((app) => {
                const Icon = iconFor[app.iconClass];
                const isSelected = app.id === selectedApp;
                const appBusy = busyAction?.endsWith(`:${app.id}`) ?? false;

                return (
                  <div
                    className={`table-row ${isSelected ? "selected" : ""}`}
                    role="row"
                    data-app={app.id}
                    key={app.id}
                    onClick={() => setSelectedApp(app.id)}
                  >
                    <span className="app-name" role="cell">
                      <span className={`app-icon ${app.iconClass}`} aria-hidden="true">
                        <Icon size={16} />
                      </span>
                      <span>
                        <strong>{app.title}</strong>
                        <small>{app.description}</small>
                      </span>
                    </span>
                    <span role="cell">
                      <span className={`status ${app.statusClass}`}>{app.status}</span>
                    </span>
                    <span role="cell">{app.port}</span>
                    <span role="cell">{app.mode}</span>
                    <span className="controls" role="cell">
                      <button
                        type="button"
                        title={app.status === "Running" ? "Stop" : "Start"}
                        aria-label={`${app.status === "Running" ? "Stop" : "Start"} ${app.title}`}
                        disabled={busyAction !== null}
                        onClick={(event) => {
                          event.stopPropagation();
                          void runAction(app.status === "Running" ? "stop" : "start", app.id);
                        }}
                      >
                        {app.status === "Running" ? <Square size={14} /> : <Play size={14} />}
                      </button>
                      <button
                        type="button"
                        title="Restart"
                        aria-label={`Restart ${app.title}`}
                        disabled={busyAction !== null}
                        onClick={(event) => {
                          event.stopPropagation();
                          void runAction("restart", app.id);
                        }}
                      >
                        <RefreshCcw className={appBusy ? "spin" : ""} size={14} />
                      </button>
                      <button
                        type="button"
                        title="Open"
                        aria-label={`Open ${app.title}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void openApp(app);
                        }}
                      >
                        <ExternalLink size={14} />
                      </button>
                      <button type="button" title="Settings" aria-label={`${app.title} settings`} onClick={(event) => event.stopPropagation()}>
                        <Settings size={14} />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <aside className="inspector" aria-label="Selected app detail">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Selected</span>
                <h2>{selected.title}</h2>
              </div>
              <span className={`status ${selected.statusClass}`}>{selected.status}</span>
            </div>

            <dl className="detail-list">
              <div>
                <dt>URL</dt>
                <dd>{selected.url}</dd>
              </div>
              <div>
                <dt>Command</dt>
                <dd>{selected.command}</dd>
              </div>
              <div>
                <dt>Workspace</dt>
                <dd>{selected.path}</dd>
              </div>
              <div>
                <dt>Health</dt>
                <dd>{selected.health}</dd>
              </div>
              <div>
                <dt>Controller</dt>
                <dd>
                  {selected.managed
                    ? `Managed PID ${selected.pid}`
                    : selected.status === "Running"
                      ? "Detected from registered health check"
                      : "Not started by this dashboard"}
                </dd>
              </div>
            </dl>

            <div className="inspector-actions">
              <button className="command-button primary" type="button" disabled={busyAction !== null} onClick={() => runAction("start")}>
                <Play size={16} aria-hidden="true" />
                Start
              </button>
              <button className="command-button" type="button" disabled={busyAction !== null} onClick={() => runAction("stop")}>
                <Square size={16} aria-hidden="true" />
                Stop
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label="Restart selected app"
                title="Restart"
                disabled={busyAction !== null}
                onClick={() => runAction("restart")}
              >
                <RefreshCcw size={17} aria-hidden="true" />
              </button>
              <button className="icon-button" type="button" aria-label="Open selected app" title="Open" onClick={() => openApp()}>
                <ExternalLink size={17} aria-hidden="true" />
              </button>
            </div>

            <section className="notes" aria-label="Operational notes">
              <span className="eyebrow">Notes</span>
              <p>{selected.notes}</p>
            </section>
          </aside>
        </section>

        <section className={`log-drawer ${logsPinned ? "pinned" : ""}`} aria-label="Logs">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Live Logs</span>
              <h2>{selected.title}</h2>
            </div>
            <div className="log-tools" aria-label="Log controls">
              <button className="icon-button" type="button" aria-label="Clear logs" title="Clear" onClick={clearLogs}>
                <Trash2 size={17} aria-hidden="true" />
              </button>
              <button className="icon-button" type="button" aria-label="Pin logs" title="Pin" onClick={() => setLogsPinned((value) => !value)}>
                <Pin size={17} aria-hidden="true" />
              </button>
            </div>
          </div>
          <pre>{selected.logs.length ? selected.logs.join("\n") : "No logs yet."}</pre>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
