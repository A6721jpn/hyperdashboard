import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  ExternalLink,
  FileImage,
  Filter,
  Image,
  List,
  Logs,
  MessageSquare,
  Pin,
  Play,
  Plus,
  Power,
  Presentation,
  RefreshCcw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Terminal,
  Trash2,
} from "lucide-react";
import "./styles.css";

type AppStatus = "Running" | "Starting" | "Stopped" | "Idle" | "Error";
type StatusClass = "running" | "starting" | "stopped" | "warning" | "error";
type AppIcon = "image" | "chat" | "slide";
type DashboardView = "apps" | "sessions" | "logs" | "settings";

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
  startedAt: string | null;
  lastHealthCheckAt: string | null;
  stopPorts: number[];
  logs: string[];
};

type AppsResponse = {
  apps: LocalApp[];
};

type ControllerSettings = {
  rootDir: string;
  bindHost: string;
  controllerPort: number;
  maxLogLines: number;
  apps: Array<{
    id: string;
    title: string;
    category: string;
    workspacePath: string;
    command: string;
    url: string;
    healthCheckUrl: string;
    stopPorts: number[];
    notes: string;
  }>;
};

type LogScope = "all" | string;

const iconFor: Record<AppIcon, typeof Image> = {
  image: FileImage,
  chat: MessageSquare,
  slide: Presentation,
};

const viewMeta: Record<DashboardView, { eyebrow: string; title: string; search: string }> = {
  apps: {
    eyebrow: "Dashboard",
    title: "Apps",
    search: "Search apps or commands",
  },
  sessions: {
    eyebrow: "Runtime",
    title: "Sessions",
    search: "Search sessions, PIDs, or paths",
  },
  logs: {
    eyebrow: "Operations",
    title: "Logs",
    search: "Search log lines",
  },
  settings: {
    eyebrow: "Controller",
    title: "Settings",
    search: "Search settings and app definitions",
  },
};

const statusRank: Record<AppStatus, number> = {
  Error: 0,
  Starting: 1,
  Running: 2,
  Idle: 3,
  Stopped: 4,
};

function formatDate(value: string | null) {
  if (!value) {
    return "Not started";
  }
  return new Date(value).toLocaleString();
}

function formatDuration(value: string | null) {
  if (!value) {
    return "0m";
  }

  const elapsed = Date.now() - new Date(value).getTime();
  if (elapsed < 60_000) {
    return "<1m";
  }

  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function App() {
  const [apps, setApps] = useState<LocalApp[]>([]);
  const [settingsData, setSettingsData] = useState<ControllerSettings | null>(null);
  const [activeView, setActiveView] = useState<DashboardView>("apps");
  const [selectedApp, setSelectedApp] = useState("image");
  const [query, setQuery] = useState("");
  const [sortByStatus, setSortByStatus] = useState(false);
  const [logsPinned, setLogsPinned] = useState(true);
  const [logScope, setLogScope] = useState<LogScope>("all");
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(3);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const selected = apps.find((app) => app.id === selectedApp) ?? apps[0];
  const meta = viewMeta[activeView];

  const visibleApps = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = normalized
      ? apps.filter((app) =>
          [app.title, app.description, app.mode, app.command, app.path, app.health].some((value) =>
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

  const allLogs = useMemo(
    () =>
      apps.flatMap((app) =>
        app.logs.map((line, index) => ({
          id: `${app.id}-${index}`,
          appId: app.id,
          appTitle: app.title,
          status: app.status,
          statusClass: app.statusClass,
          line,
        })),
      ),
    [apps],
  );

  const filteredLogs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return allLogs.filter((entry) => {
      const scopeMatch = logScope === "all" || entry.appId === logScope;
      const queryMatch =
        !normalized ||
        [entry.appTitle, entry.status, entry.line].some((value) => value.toLowerCase().includes(normalized));
      return scopeMatch && queryMatch;
    });
  }, [allLogs, logScope, query]);

  async function refreshSettings() {
    const response = await fetch("/api/settings", { cache: "no-store" });
    if (response.ok) {
      setSettingsData((await response.json()) as ControllerSettings);
    }
  }

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

  async function refreshAll(options: { quiet?: boolean } = {}) {
    await refreshApps(options);
    try {
      await refreshSettings();
    } catch {
      if (!options.quiet) {
        setBanner("Could not load controller settings.");
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

  async function clearLogs(appId = selected?.id) {
    if (!appId) {
      return;
    }
    const response = await fetch(`/api/apps/${appId}/logs`, { method: "DELETE" });
    if (response.ok) {
      const data = await response.json();
      setApps(data.apps);
    }
  }

  async function clearAllLogs() {
    const response = await fetch("/api/logs", { method: "DELETE" });
    if (response.ok) {
      const data = await response.json();
      setApps(data.apps);
    }
  }

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    if (autoRefreshSeconds <= 0) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void refreshApps({ quiet: true });
    }, autoRefreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefreshSeconds]);

  if (!selected) {
    return (
      <main className="empty-state">
        <AlertCircle size={28} aria-hidden="true" />
        <h1>Hypardashboard</h1>
        <p>Waiting for the local controller API.</p>
      </main>
    );
  }

  function renderNavItem(view: DashboardView, Icon: typeof List, label: string) {
    return (
      <button
        className={`nav-item ${activeView === view ? "active" : ""}`}
        type="button"
        onClick={() => {
          setActiveView(view);
          setQuery("");
        }}
      >
        <Icon className="nav-icon" size={18} aria-hidden="true" />
        {label}
      </button>
    );
  }

  function renderMetrics() {
    return (
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
    );
  }

  function renderAppRows(appList: LocalApp[]) {
    return appList.map((app) => {
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
            <button
              type="button"
              title="Settings"
              aria-label={`${app.title} settings`}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedApp(app.id);
                setActiveView("settings");
              }}
            >
              <Settings size={14} />
            </button>
          </span>
        </div>
      );
    });
  }

  function renderInspector() {
    return (
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
    );
  }

  function renderLiveLogDrawer() {
    return (
      <section className={`log-drawer ${logsPinned ? "pinned" : ""}`} aria-label="Logs">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Live Logs</span>
            <h2>{selected.title}</h2>
          </div>
          <div className="log-tools" aria-label="Log controls">
            <button className="icon-button" type="button" aria-label="Clear logs" title="Clear" onClick={() => clearLogs()}>
              <Trash2 size={17} aria-hidden="true" />
            </button>
            <button className="icon-button" type="button" aria-label="Pin logs" title="Pin" onClick={() => setLogsPinned((value) => !value)}>
              <Pin size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
        <pre>{selected.logs.length ? selected.logs.join("\n") : "No logs yet."}</pre>
      </section>
    );
  }

  function renderAppsView() {
    return (
      <>
        {renderMetrics()}
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
              {renderAppRows(visibleApps)}
            </div>
          </div>
          {renderInspector()}
        </section>
        {renderLiveLogDrawer()}
      </>
    );
  }

  function renderSessionsView() {
    return (
      <>
        {renderMetrics()}
        <section className="session-grid" aria-label="Runtime sessions">
          {visibleApps.map((app) => (
            <article className="session-card" key={app.id}>
              <div className="session-card-head">
                <div className="app-name">
                  <span className={`app-icon ${app.iconClass}`} aria-hidden="true">
                    {(() => {
                      const Icon = iconFor[app.iconClass];
                      return <Icon size={16} />;
                    })()}
                  </span>
                  <span>
                    <strong>{app.title}</strong>
                    <small>{app.managed ? `Managed PID ${app.pid}` : app.status === "Running" ? "External process" : "No session"}</small>
                  </span>
                </div>
                <span className={`status ${app.statusClass}`}>{app.status}</span>
              </div>
              <dl className="session-facts">
                <div>
                  <dt>Uptime</dt>
                  <dd>{formatDuration(app.startedAt)}</dd>
                </div>
                <div>
                  <dt>Started</dt>
                  <dd>{formatDate(app.startedAt)}</dd>
                </div>
                <div>
                  <dt>Health</dt>
                  <dd>{app.health}</dd>
                </div>
                <div>
                  <dt>Workspace</dt>
                  <dd>{app.path}</dd>
                </div>
              </dl>
              <div className="card-actions">
                <button className="command-button primary" type="button" disabled={busyAction !== null} onClick={() => runAction("start", app.id)}>
                  <Play size={16} aria-hidden="true" />
                  Start
                </button>
                <button className="command-button" type="button" disabled={busyAction !== null} onClick={() => runAction("stop", app.id)}>
                  <Square size={16} aria-hidden="true" />
                  Stop
                </button>
                <button className="icon-button" type="button" aria-label={`Open ${app.title}`} title="Open" onClick={() => openApp(app)}>
                  <ExternalLink size={17} aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
        </section>
      </>
    );
  }

  function renderLogsView() {
    return (
      <section className="view-panel logs-view" aria-label="All logs">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Aggregate</span>
            <h2>All App Logs</h2>
          </div>
          <div className="log-tools" aria-label="Log controls">
            <button className="command-button" type="button" onClick={clearAllLogs}>
              <Trash2 size={16} aria-hidden="true" />
              Clear All
            </button>
            <button className="icon-button" type="button" aria-label="Refresh logs" title="Refresh" onClick={() => refreshApps()}>
              <RefreshCcw size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="filter-bar">
          <span className="filter-label">
            <Filter size={16} aria-hidden="true" />
            Source
          </span>
          <button className={`chip ${logScope === "all" ? "active" : ""}`} type="button" onClick={() => setLogScope("all")}>
            All
          </button>
          {apps.map((app) => (
            <button
              className={`chip ${logScope === app.id ? "active" : ""}`}
              type="button"
              key={app.id}
              onClick={() => {
                setLogScope(app.id);
                setSelectedApp(app.id);
              }}
            >
              {app.title}
            </button>
          ))}
        </div>
        <div className="log-list" role="log" aria-label="Aggregated log lines">
          {filteredLogs.length ? (
            filteredLogs.map((entry) => (
              <button
                className="log-line"
                type="button"
                key={entry.id}
                onClick={() => {
                  setSelectedApp(entry.appId);
                  setLogScope(entry.appId);
                }}
              >
                <span className={`status micro ${entry.statusClass}`}>{entry.appTitle}</span>
                <code>{entry.line}</code>
              </button>
            ))
          ) : (
            <p className="empty-copy">No log lines match the current filter.</p>
          )}
        </div>
      </section>
    );
  }

  function renderSettingsView() {
    const settingApps = settingsData?.apps.filter((app) => {
      const normalized = query.trim().toLowerCase();
      return (
        !normalized ||
        [app.title, app.command, app.workspacePath, app.url, app.healthCheckUrl].some((value) =>
          value.toLowerCase().includes(normalized),
        )
      );
    });

    return (
      <section className="settings-layout" aria-label="Settings">
        <article className="view-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Controller</span>
              <h2>Runtime Settings</h2>
            </div>
            <ShieldCheck size={19} aria-hidden="true" />
          </div>
          <dl className="detail-list settings-list">
            <div>
              <dt>Root</dt>
              <dd>{settingsData?.rootDir ?? "Loading"}</dd>
            </div>
            <div>
              <dt>Bind Host</dt>
              <dd>{settingsData?.bindHost ?? "127.0.0.1"}</dd>
            </div>
            <div>
              <dt>Controller Port</dt>
              <dd>{settingsData?.controllerPort ?? 5175}</dd>
            </div>
            <div>
              <dt>Log Retention</dt>
              <dd>{settingsData?.maxLogLines ?? 180} lines per app</dd>
            </div>
            <div>
              <dt>Auto Refresh</dt>
              <dd>
                <select value={autoRefreshSeconds} onChange={(event) => setAutoRefreshSeconds(Number(event.target.value))}>
                  <option value={0}>Off</option>
                  <option value={2}>Every 2 seconds</option>
                  <option value={3}>Every 3 seconds</option>
                  <option value={5}>Every 5 seconds</option>
                  <option value={10}>Every 10 seconds</option>
                </select>
              </dd>
            </div>
          </dl>
          <div className="settings-actions">
            <button className="command-button" type="button" onClick={() => refreshAll()}>
              <RefreshCcw size={16} aria-hidden="true" />
              Refresh Controller
            </button>
            <button className="command-button" type="button" onClick={clearAllLogs}>
              <Trash2 size={16} aria-hidden="true" />
              Clear Logs
            </button>
          </div>
        </article>

        <article className="view-panel settings-apps">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Registered</span>
              <h2>App Definitions</h2>
            </div>
            <SlidersHorizontal size={19} aria-hidden="true" />
          </div>
          <div className="settings-table">
            {(settingApps ?? []).map((definition) => {
              const app = apps.find((item) => item.id === definition.id);
              return (
                <section className="setting-row" key={definition.id}>
                  <div>
                    <strong>{definition.title}</strong>
                    <span className={`status micro ${app?.statusClass ?? "stopped"}`}>{app?.status ?? "Unknown"}</span>
                  </div>
                  <dl>
                    <div>
                      <dt>Command</dt>
                      <dd>{definition.command}</dd>
                    </div>
                    <div>
                      <dt>URL</dt>
                      <dd>{definition.url}</dd>
                    </div>
                    <div>
                      <dt>Health</dt>
                      <dd>{definition.healthCheckUrl}</dd>
                    </div>
                    <div>
                      <dt>Stop Ports</dt>
                      <dd>{definition.stopPorts.join(", ")}</dd>
                    </div>
                    <div>
                      <dt>Workspace</dt>
                      <dd>{definition.workspacePath}</dd>
                    </div>
                  </dl>
                  <div className="card-actions">
                    <button className="command-button primary" type="button" disabled={busyAction !== null} onClick={() => runAction("start", definition.id)}>
                      <Play size={16} aria-hidden="true" />
                      Start
                    </button>
                    <button className="command-button" type="button" disabled={busyAction !== null} onClick={() => runAction("stop", definition.id)}>
                      <Square size={16} aria-hidden="true" />
                      Stop
                    </button>
                    <button className="icon-button" type="button" aria-label={`Open ${definition.title}`} title="Open" onClick={() => app && openApp(app)}>
                      <ExternalLink size={17} aria-hidden="true" />
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        </article>
      </section>
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
          {renderNavItem("apps", List, "Apps")}
          {renderNavItem("sessions", Terminal, "Sessions")}
          {renderNavItem("logs", Logs, "Logs")}
          {renderNavItem("settings", Settings, "Settings")}
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
            <Power size={16} aria-hidden="true" />
            Stop All
          </button>
        </section>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <span className="eyebrow">{meta.eyebrow}</span>
            <h1>{meta.title}</h1>
          </div>
          <div className="topbar-actions">
            <label className="search">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                placeholder={meta.search}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button className="icon-button" type="button" aria-label="Refresh apps" title="Refresh" onClick={() => refreshAll()}>
              <RefreshCcw size={18} aria-hidden="true" />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="Add app"
              title="Add app"
              onClick={() => {
                setQuery("");
                setActiveView("settings");
              }}
            >
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

        {activeView === "apps" ? renderAppsView() : null}
        {activeView === "sessions" ? renderSessionsView() : null}
        {activeView === "logs" ? renderLogsView() : null}
        {activeView === "settings" ? renderSettingsView() : null}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
