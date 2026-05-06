import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Activity, BarChart3, Bell, Gauge, Search, Settings, Sparkles } from "lucide-react";
import "./styles.css";

const metrics = [
  { label: "Revenue", value: "$128.4K", delta: "+12.8%" },
  { label: "Active users", value: "24,918", delta: "+8.1%" },
  { label: "Conversion", value: "7.42%", delta: "+1.9%" },
  { label: "Alerts", value: "14", delta: "-3" },
];

const events = [
  "North America pipeline crossed target",
  "Latency monitor returned to normal",
  "New forecast model completed",
  "Billing sync queued for review",
];

function App() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Gauge size={24} />
          <span>Hyperdashboard</span>
        </div>
        <nav className="nav">
          <a className="active" href="#"><BarChart3 size={18} /> Overview</a>
          <a href="#"><Activity size={18} /> Activity</a>
          <a href="#"><Bell size={18} /> Alerts</a>
          <a href="#"><Settings size={18} /> Settings</a>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Operations</p>
            <h1>Command center</h1>
          </div>
          <label className="search">
            <Search size={18} />
            <input aria-label="Search dashboard" placeholder="Search" />
          </label>
        </header>

        <section className="metrics" aria-label="Key metrics">
          {metrics.map((metric) => (
            <article className="metric" key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <em>{metric.delta}</em>
            </article>
          ))}
        </section>

        <section className="grid">
          <article className="panel chart-panel">
            <div className="panel-title">
              <h2>Performance</h2>
              <Sparkles size={18} />
            </div>
            <div className="bars" aria-hidden="true">
              {[44, 68, 51, 82, 74, 93, 88, 72, 97, 84, 91, 99].map((height, index) => (
                <span key={index} style={{ height: `${height}%` }} />
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-title">
              <h2>Live events</h2>
              <Activity size={18} />
            </div>
            <ul className="events">
              {events.map((event) => (
                <li key={event}>{event}</li>
              ))}
            </ul>
          </article>
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
