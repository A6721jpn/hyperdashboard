import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Clipboard,
  FileText,
  Layers3,
  Loader2,
  MonitorCheck,
  Play,
  Presentation,
  RefreshCw,
  Sparkles,
  Wand2,
} from "lucide-react";
import "./styles.css";

type DetailLevel = "live" | "memo" | "appendix";
type Tone = "executive" | "product" | "educational" | "pitch" | "playful";
type Language = "English" | "Japanese" | "Bilingual";
type RunStatus = "idle" | "ready" | "running" | "done" | "error";

type Brief = {
  title: string;
  prompt: string;
  audience: string;
  outcome: string;
  tone: Tone;
  slideCount: number;
  language: Language;
  detailLevel: DetailLevel;
  templateUrl: string;
  sourceMaterial: string;
  visualDirection: string;
  useImages: boolean;
  verifyThumbnails: boolean;
  needsResearch: boolean;
};

type SlidePlan = {
  id: string;
  number: number;
  title: string;
  job: string;
  message: string;
  visual: string;
  layout: string;
  qa: string;
};

type ModelOption = {
  id?: string;
  model?: string;
  displayName?: string;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: Array<string | { reasoningEffort?: string; effort?: string }>;
  isDefault?: boolean;
};

type StreamEvent =
  | { type: "thread"; codexThreadId: string }
  | { type: "delta"; text: string }
  | { type: "final"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

const briefKey = "hypardashboard.slide-builder.brief.v2";

const baselineStyleName = "No-zabuton editorial baseline";

const defaultFlavor =
  "Use the no-zabuton editorial baseline. Let my prompt add only subject-specific flavor: mood, palette, imagery, pacing, and emphasis.";

const baselineDesignRules = [
  "- Baseline style: no-zabuton editorial. Build slides from open typography, generous whitespace, direct labels, native rules/rails, and a few strong visual signals.",
  "- Use the three accepted prototype patterns as defaults: A) type-led statement slide, B) native rail or axis with separately anchored labels, C) sparse decision slide with no competing side note.",
  "- Treat the user's prompt as flavor on top of the baseline. It may change mood, palette, imagery, pacing, examples, or emphasis, but it should not reintroduce decorative cards, boxed prose, or fragile alignment.",
  "- If the user's flavor conflicts with the baseline, keep the baseline unless the user explicitly asks for that departure and it improves the deck's job.",
  "- Prefer restrained color accents over theme-heavy decoration. The deck should feel authored, editable, and calm rather than like a component dashboard.",
];

const defaultBrief: Brief = {
  title: "AI product launch narrative",
  prompt: "Create a polished deck that explains a new AI workflow product, why it matters, how it works, and what decision the audience should make next.",
  audience: "Product leaders and operators",
  outcome: "Approve a pilot and agree on the first use case",
  tone: "product",
  slideCount: 7,
  language: "English",
  detailLevel: "live",
  templateUrl: "",
  sourceMaterial: "",
  visualDirection: defaultFlavor,
  useImages: true,
  verifyThumbnails: true,
  needsResearch: false,
};

const roleFrames = [
  {
    title: "Cover",
    job: "Set the promise",
    message: "Name the deck and make the audience want the next slide.",
    visual: "Prompt-specific hero visual, artifact crop, or strong type-led opener.",
    layout: "Distinct cover with open whitespace. No boxed title area or decorative panels.",
  },
  {
    title: "Why now",
    job: "Establish context",
    message: "Show the change or pressure that makes the topic timely.",
    visual: "One strong evidence object or annotated context visual with direct labels.",
    layout: "Open editorial layout with one dominant read. Use rules or margin notes instead of cards.",
  },
  {
    title: "Audience pain",
    job: "Frame the problem",
    message: "Describe the friction the audience already recognizes.",
    visual: "Before-state path, short quote, or compact comparison with minimal framing.",
    layout: "Use open type, thin dividers, or a single necessary table. Avoid boxed prose.",
  },
  {
    title: "Proposed answer",
    job: "Introduce the solution",
    message: "Make the core idea concrete and memorable.",
    visual: "Product screenshot, generated concept image, or simple system diagram with labels sitting on the canvas.",
    layout: "Large visual with direct labels; no caption cards or boxed prose.",
  },
  {
    title: "How it works",
    job: "Explain mechanism",
    message: "Show the few steps that make the approach believable.",
    visual: "Connectors-first native flow diagram using labels, lines, and small anchor marks.",
    layout: "Diagram with edges behind text. Avoid putting every step inside a card.",
  },
  {
    title: "Proof",
    job: "Build confidence",
    message: "Use evidence, examples, or expected outcomes to support the claim.",
    visual: "Editable chart, table, or annotated proof object only when the evidence needs it.",
    layout: "One foreground signal plus quiet supporting detail. Do not wrap metrics in decorative tiles.",
  },
  {
    title: "Operating plan",
    job: "Make it actionable",
    message: "Clarify owners, timing, and the first milestone.",
    visual: "Milestone rail, timeline line, or compact responsibility table if needed.",
    layout: "Functional, open, and scan-friendly. Avoid dashboard panels.",
  },
  {
    title: "Risks",
    job: "Show judgment",
    message: "Name the risks and the mitigation choices.",
    visual: "Ranked list, open decision matrix, or table only if it improves comparison.",
    layout: "Readable but light. Use row rules and spacing before filled cells.",
  },
  {
    title: "Decision",
    job: "Land the ask",
    message: "State the specific decision and immediate next step.",
    visual: "Minimal closing slide with one clear action or one decisive statement.",
    layout: "Sparse, confident close. No callout card unless it is the actual artifact.",
  },
];

const containerDisciplineRules = [
  "- Avoid unnecessary containers: no decorative cards, panels, boxed prose, background rectangles, pill stacks, or 'zabuton' behind text by default.",
  "- Use open typography first. Put text directly on the canvas with strong hierarchy, spacing, rules, leader lines, and direct labels.",
  "- Allow a visible box only when it holds a real object that naturally needs a frame: screenshot, chart, table, code/output artifact, quote artifact, or form-like object.",
  "- Never make every step, metric, or bullet a separate card. If a flow is needed, use lines, arrows, numbers, and text labels rather than a row of boxed nodes.",
  "- During thumbnail QA, treat excessive decorative boxes as a visual defect and simplify the slide before handoff.",
];

const visualFailurePreventionRules = [
  "- Do not fake axes, timelines, tables, or alignment by typing spaced strings, repeated glyphs, or monospaced text. Use native lines/connectors/shapes and separate anchored labels.",
  "- For every rail, axis, timeline, or process diagram, make each dot, tick, label, and connector its own editable element with explicit geometry. Labels must visually align with their anchors.",
  "- Never put multiple independent labels into one text box and align them with spaces. Use one text box per label or a real table.",
  "- Shorten labels before they wrap inside narrow text boxes. Treat accidental line breaks, orphaned characters, and uneven label baselines as QA failures.",
  "- Keep explanatory side notes outside the bounding area of large titles and body text. If a note competes with a headline, move it or delete it.",
  "- Thumbnail QA must inspect for: clipped text, text overlap, accidental wrapping, axis/tick/label misalignment, stray repeated glyph lines, stale placeholders, edge crowding, and excessive containers.",
  "- After any visual patch, fetch a fresh large thumbnail again. Do not claim QA passed from a pre-patch thumbnail, API success, or object JSON alone.",
  "- If a thumbnail cannot be inspected, report the slide as unresolved instead of saying QA passed.",
];

const capabilityRows = [
  {
    name: "Codex app-server",
    role: "Core runtime",
    detail: "The browser sends one structured deck-building turn to Codex.",
  },
  {
    name: "Presentations plugin",
    role: "Local PPTX authoring",
    detail: "Preferred path for editable deck creation before native Slides import.",
  },
  {
    name: "Google Drive / Slides",
    role: "Native Slides delivery",
    detail: "Import, readback, batch edits, and thumbnail verification.",
  },
  {
    name: "openaiDeveloperDocs MCP",
    role: "Docs verification",
    detail: "Used by Codex when current OpenAI/Codex behavior needs checking.",
  },
  {
    name: "node_repl",
    role: "Helper runtime",
    detail: "Useful for JSON shaping, data cleanup, and small asset utilities.",
  },
];

function loadBrief(): Brief {
  try {
    return { ...defaultBrief, ...JSON.parse(localStorage.getItem(briefKey) ?? "{}") };
  } catch {
    return defaultBrief;
  }
}

function clampSlideCount(value: number) {
  return Math.min(12, Math.max(3, Math.round(value)));
}

function modelId(model: ModelOption) {
  return model.model ?? model.id ?? "";
}

function createSlidePlan(brief: Brief): SlidePlan[] {
  const count = clampSlideCount(brief.slideCount);
  const selectedFrames = roleFrames.slice(0, count);
  const finalFrame = roleFrames[roleFrames.length - 1];
  const frames = count < roleFrames.length
    ? [...selectedFrames.slice(0, count - 1), finalFrame]
    : selectedFrames;

  return frames.map((frame, index) => ({
    id: `slide-${index + 1}-${frame.title.toLowerCase().replace(/\s+/g, "-")}`,
    number: index + 1,
    title: index === 0 ? brief.title.trim() || frame.title : frame.title,
    job: frame.job,
    message: index === 0
      ? `Position the deck for ${brief.audience || "the audience"} and signal: ${brief.outcome || "the intended decision"}.`
      : frame.message,
    visual: brief.useImages ? frame.visual : frame.visual.replace("image, ", "").replace("generated concept image, ", ""),
    layout: frame.layout,
    qa: "Readable text, no clipping, no stale placeholders, thumbnail checked.",
  }));
}

function buildCodexPrompt(brief: Brief, plan: SlidePlan[]) {
  const sourceBlock = brief.sourceMaterial.trim()
    ? brief.sourceMaterial.trim()
    : "No source material supplied. Use the user brief and verify any current factual claims before using them.";

  return [
    "Create an editable native Google Slides deck from this structured brief.",
    "",
    "Do not passively summarize the prompt. Turn it into a complete deck using the workflow below.",
    "",
    "Workflow requirements:",
    "1. Treat Codex app-server as the orchestration layer.",
    "2. Use the Presentations plugin or PowerPoint authoring path when available to create a local editable PPTX first.",
    "3. Import the PPTX through the Google Drive connector as native Google Slides with upload_mode native_google_slides.",
    "4. If a template URL is supplied, copy the template first and edit only the copy.",
    "5. Use Google Slides connector readback after import or edits to confirm presentation id, title, slide count, and slide object ids.",
    "6. Use fresh large thumbnails for the touched slides and patch any visible clipping, overlap, stale placeholder text, or bad cropping.",
    "7. Final output must be an editable Google Slides deck, not slide-sized screenshots.",
    "",
    "Plugin and MCP routing:",
    "- Prefer Presentations plugin for local PPTX generation.",
    "- Use Google Drive / Google Slides connector for native import, readback, existing deck edits, and thumbnail QA.",
    "- Use node_repl only for source processing or helper transformations, not connector calls.",
    "- Use openaiDeveloperDocs MCP only when current Codex/OpenAI behavior needs verification.",
    "",
    "Deck brief:",
    `- Title: ${brief.title}`,
    `- Audience: ${brief.audience}`,
    `- Decision or outcome: ${brief.outcome}`,
    `- Tone: ${brief.tone}`,
    `- Language: ${brief.language}`,
    `- Reading load: ${brief.detailLevel}`,
    `- Slide count: ${plan.length}`,
    `- Template URL: ${brief.templateUrl.trim() || "none"}`,
    `- Baseline style: ${baselineStyleName}`,
    `- User flavor on baseline: ${brief.visualDirection}`,
    `- Use images: ${brief.useImages ? "yes" : "no"}`,
    `- Needs current research: ${brief.needsResearch ? "yes" : "no"}`,
    `- Thumbnail QA required: ${brief.verifyThumbnails ? "yes" : "no"}`,
    "",
    "Original user prompt:",
    brief.prompt.trim(),
    "",
    "Source material:",
    sourceBlock,
    "",
    "Proposed slide plan:",
    ...plan.map((slide) => [
      `${slide.number}. ${slide.title}`,
      `   job: ${slide.job}`,
      `   message: ${slide.message}`,
      `   visual: ${slide.visual}`,
      `   layout: ${slide.layout}`,
      `   QA: ${slide.qa}`,
    ].join("\n")),
    "",
    "Design rules:",
    "- One slide, one job, one dominant read.",
    "- Keep titles short enough to avoid accidental wrapping.",
    "- Prefer real images, generated raster visuals, editable charts/tables, or native diagrams over prose-heavy slides.",
    ...baselineDesignRules,
    ...containerDisciplineRules,
    ...visualFailurePreventionRules,
    "- Keep all text and important content inside slide bounds.",
    "- If content does not fit, shorten, split, or redesign instead of shrinking text below readability.",
    "",
    "Final response contract:",
    "- Google Slides link",
    "- Deck title",
    "- Slide count",
    "- Confirmation of native Google Slides readback",
    "- Thumbnail QA summary",
    "- Any unresolved issue",
  ].join("\n");
}

function extractSlidesLink(text: string) {
  return text.match(/https:\/\/docs\.google\.com\/presentation\/d\/[^\s)]+/i)?.[0] ?? "";
}

function App() {
  const [brief, setBrief] = useState(loadBrief);
  const [plan, setPlan] = useState<SlidePlan[]>(() => createSlidePlan(loadBrief()));
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState("gpt-5.5");
  const [effort, setEffort] = useState("medium");
  const [serverStatus, setServerStatus] = useState("Connecting");
  const [runStatus, setRunStatus] = useState<RunStatus>("ready");
  const [codexThreadId, setCodexThreadId] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const [notice, setNotice] = useState("Ready");

  const codexPrompt = useMemo(() => buildCodexPrompt(brief, plan), [brief, plan]);
  const slidesLink = useMemo(() => extractSlidesLink(streamText), [streamText]);

  const effortOptions = useMemo(() => {
    const matched = models.find((model) => modelId(model) === selectedModel);
    const options = matched?.supportedReasoningEfforts
      ?.map((item) => typeof item === "string" ? item : item.reasoningEffort ?? item.effort)
      .filter((item): item is string => Boolean(item));
    return options && options.length > 0 ? options : ["low", "medium", "high", "xhigh"];
  }, [models, selectedModel]);

  useEffect(() => {
    localStorage.setItem(briefKey, JSON.stringify(brief));
  }, [brief]);

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
      if (defaultModel) {
        setSelectedModel(modelId(defaultModel));
        setEffort(defaultModel.defaultReasoningEffort ?? "medium");
      }
    } catch (error) {
      setServerStatus(error instanceof Error ? error.message : "Disconnected");
    }
  }

  function updateBrief<K extends keyof Brief>(key: K, value: Brief[K]) {
    setBrief((current) => ({ ...current, [key]: value }));
  }

  function regeneratePlan() {
    const nextBrief = { ...brief, slideCount: clampSlideCount(brief.slideCount) };
    setBrief(nextBrief);
    setPlan(createSlidePlan(nextBrief));
    setRunStatus("ready");
    setNotice("Plan refreshed");
  }

  async function copyPrompt() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(codexPrompt);
      } else {
        copyTextFallback(codexPrompt);
      }
      setNotice("Codex prompt copied");
    } catch {
      try {
        copyTextFallback(codexPrompt);
        setNotice("Codex prompt copied");
      } catch {
        setNotice("Clipboard is unavailable");
      }
    }
  }

  async function buildSlides() {
    if (!brief.prompt.trim()) {
      setNotice("Prompt is required");
      return;
    }

    const nextPlan = plan.length > 0 ? plan : createSlidePlan(brief);
    setPlan(nextPlan);
    setRunStatus("running");
    setStreamText("");
    setNotice("Codex is building the deck");

    try {
      const response = await fetch("/api/slides/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codexThreadId,
          model: selectedModel,
          effort,
          brief,
          plan: nextPlan,
          codexPrompt: buildCodexPrompt(brief, nextPlan),
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Build endpoint returned ${response.status}`);
      }

      const reader = response.body.getReader();
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
          handleStreamEvent(JSON.parse(line) as StreamEvent);
        }
      }

      if (buffer.trim()) {
        handleStreamEvent(JSON.parse(buffer) as StreamEvent);
      }
    } catch (error) {
      setRunStatus("error");
      setNotice(error instanceof Error ? error.message : "Build failed");
    }
  }

  function handleStreamEvent(event: StreamEvent) {
    if (event.type === "thread") {
      setCodexThreadId(event.codexThreadId);
      return;
    }

    if (event.type === "delta" || event.type === "final") {
      setStreamText((current) => current + event.text);
      return;
    }

    if (event.type === "done") {
      setRunStatus("done");
      setNotice("Build finished");
      return;
    }

    if (event.type === "error") {
      setRunStatus("error");
      setNotice(event.message);
    }
  }

  return (
    <div className="builder-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Hypardashboard</p>
          <h1>Slide Builder</h1>
        </div>
        <div className="top-actions">
          <span className="status-chip"><Bot size={16} />{serverStatus}</span>
          <button className="icon-button" type="button" onClick={refreshModels} aria-label="Refresh models" title="Refresh models">
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      <main className="builder-grid">
        <section className="panel brief-panel" aria-label="Deck brief">
          <div className="panel-heading">
            <FileText size={18} />
            <h2>Brief</h2>
          </div>

          <label className="field">
            <span>Deck title</span>
            <input value={brief.title} onChange={(event) => updateBrief("title", event.target.value)} />
          </label>

          <label className="field">
            <span>Prompt</span>
            <textarea value={brief.prompt} onChange={(event) => updateBrief("prompt", event.target.value)} />
          </label>

          <div className="two-col">
            <label className="field">
              <span>Audience</span>
              <input value={brief.audience} onChange={(event) => updateBrief("audience", event.target.value)} />
            </label>
            <label className="field">
              <span>Decision</span>
              <input value={brief.outcome} onChange={(event) => updateBrief("outcome", event.target.value)} />
            </label>
          </div>

          <div className="control-row">
            <label className="field compact">
              <span>Slides</span>
              <input
                min={3}
                max={12}
                type="number"
                value={brief.slideCount}
                onChange={(event) => updateBrief("slideCount", Number(event.target.value))}
              />
            </label>
            <label className="field compact">
              <span>Tone</span>
              <select value={brief.tone} onChange={(event) => updateBrief("tone", event.target.value as Tone)}>
                <option value="product">Product</option>
                <option value="executive">Executive</option>
                <option value="educational">Educational</option>
                <option value="pitch">Pitch</option>
                <option value="playful">Playful</option>
              </select>
            </label>
          </div>

          <div className="control-row">
            <label className="field compact">
              <span>Language</span>
              <select value={brief.language} onChange={(event) => updateBrief("language", event.target.value as Language)}>
                <option>English</option>
                <option>Japanese</option>
                <option>Bilingual</option>
              </select>
            </label>
            <label className="field compact">
              <span>Load</span>
              <select value={brief.detailLevel} onChange={(event) => updateBrief("detailLevel", event.target.value as DetailLevel)}>
                <option value="live">Live</option>
                <option value="memo">Memo</option>
                <option value="appendix">Appendix</option>
              </select>
            </label>
          </div>

          <label className="field">
            <span>Template URL</span>
            <input value={brief.templateUrl} onChange={(event) => updateBrief("templateUrl", event.target.value)} placeholder="https://docs.google.com/presentation/d/..." />
          </label>

          <label className="field">
            <span>Source material</span>
            <textarea className="short-textarea" value={brief.sourceMaterial} onChange={(event) => updateBrief("sourceMaterial", event.target.value)} />
          </label>

          <label className="field">
            <span>Flavor on baseline</span>
            <input value={brief.visualDirection} onChange={(event) => updateBrief("visualDirection", event.target.value)} />
          </label>

          <div className="toggle-grid">
            <label className="toggle">
              <input type="checkbox" checked={brief.useImages} onChange={(event) => updateBrief("useImages", event.target.checked)} />
              <span>Use visuals</span>
            </label>
            <label className="toggle">
              <input type="checkbox" checked={brief.verifyThumbnails} onChange={(event) => updateBrief("verifyThumbnails", event.target.checked)} />
              <span>Thumbnail QA</span>
            </label>
            <label className="toggle">
              <input type="checkbox" checked={brief.needsResearch} onChange={(event) => updateBrief("needsResearch", event.target.checked)} />
              <span>Research current facts</span>
            </label>
          </div>
        </section>

        <section className="panel plan-panel" aria-label="Slide plan">
          <div className="panel-heading with-actions">
            <div className="heading-title">
              <Layers3 size={18} />
              <h2>Plan</h2>
            </div>
            <button className="secondary-button" type="button" onClick={regeneratePlan}>
              <Wand2 size={17} />
              Plan
            </button>
          </div>

          <div className="slide-list">
            {plan.map((slide) => (
              <article className="slide-row" key={slide.id}>
                <span className="slide-number">{slide.number}</span>
                <div className="slide-copy">
                  <h3>{slide.title}</h3>
                  <p>{slide.job}</p>
                  <small>{slide.message}</small>
                </div>
                <div className="slide-meta">
                  <span>{slide.layout}</span>
                  <span>{slide.visual}</span>
                </div>
              </article>
            ))}
          </div>

          <div className="prompt-block">
            <div className="prompt-header">
              <span>Codex prompt</span>
              <button className="icon-button small" type="button" onClick={copyPrompt} aria-label="Copy Codex prompt" title="Copy Codex prompt">
                <Clipboard size={16} />
              </button>
            </div>
            <textarea readOnly value={codexPrompt} />
          </div>
        </section>

        <section className="panel run-panel" aria-label="Build run">
          <div className="panel-heading">
            <MonitorCheck size={18} />
            <h2>Build</h2>
          </div>

          <div className="runtime-controls">
            <label className="field compact">
              <span>Model</span>
              <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
                {(models.length > 0 ? models : [{ model: selectedModel, displayName: selectedModel }]).map((model) => (
                  <option key={modelId(model)} value={modelId(model)}>
                    {model.displayName ?? modelId(model)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field compact">
              <span>Effort</span>
              <select value={effort} onChange={(event) => setEffort(event.target.value)}>
                {effortOptions.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
          </div>

          <button className="build-button" type="button" onClick={buildSlides} disabled={runStatus === "running"}>
            {runStatus === "running" ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
            Build Google Slides
          </button>

          <div className="stage-list">
            <Stage active={runStatus === "running"} done={runStatus === "done"} label="Structured prompt" />
            <Stage active={runStatus === "running"} done={runStatus === "done"} label="Codex app-server turn" />
            <Stage active={runStatus === "running"} done={runStatus === "done"} label="PPTX and native Slides" />
            <Stage active={runStatus === "running"} done={runStatus === "done"} label="Readback and thumbnails" />
          </div>

          <div className="capability-list">
            {capabilityRows.map((item) => (
              <div className="capability" key={item.name}>
                <strong>{item.name}</strong>
                <span>{item.role}</span>
                <small>{item.detail}</small>
              </div>
            ))}
          </div>

          <div className="result-box">
            <div className="result-header">
              <span>{notice}</span>
              {slidesLink ? (
                <a className="link-button" href={slidesLink} target="_blank" rel="noreferrer">
                  <ArrowUpRight size={16} />
                  Open
                </a>
              ) : null}
            </div>
            <pre>{streamText || "No run output yet."}</pre>
          </div>
        </section>
      </main>
    </div>
  );
}

function Stage({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div className={`stage ${done ? "done" : ""} ${active ? "active" : ""}`}>
      {done ? <CheckCircle2 size={16} /> : active ? <Sparkles size={16} /> : <Presentation size={16} />}
      <span>{label}</span>
    </div>
  );
}

function copyTextFallback(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error("execCommand copy failed");
  }
}

const rootElement = document.getElementById("root")!;
const rootStore = globalThis as typeof globalThis & {
  __slideBuilderRoot?: ReturnType<typeof createRoot>;
};
rootStore.__slideBuilderRoot ??= createRoot(rootElement);
rootStore.__slideBuilderRoot.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
