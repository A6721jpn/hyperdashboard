import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Check,
  ImagePlus,
  Loader2,
  Palette,
  RefreshCw,
  Sparkles,
  Type,
} from "lucide-react";
import "./styles.css";

type SizePreset = {
  label: string;
  value: string;
  width: number;
  height: number;
};

type GeneratedImage = {
  id: string;
  status: "queued" | "generating" | "done" | "error";
  imageUrl?: string;
  error?: string;
  revisedPrompt?: string;
  durationMs?: number;
};

type TokenBalance = {
  imagegenRemaining: number | null;
  codexRemaining: number | null;
  resetLabel: string;
};

const sizePresets: SizePreset[] = [
  { label: "Square", value: "1024x1024", width: 1024, height: 1024 },
  { label: "Portrait", value: "1024x1536", width: 1024, height: 1536 },
  { label: "Landscape", value: "1536x1024", width: 1536, height: 1024 },
  { label: "Wide", value: "1792x1024", width: 1792, height: 1024 },
];

const fontOptions = [
  "Inter",
  "Noto Sans JP",
  "Zen Kaku Gothic New",
  "Shippori Mincho",
  "BIZ UDPGothic",
  "Playfair Display",
  "Space Grotesk",
  "IBM Plex Mono",
];

const countOptions = Array.from({ length: 8 }, (_, index) => index + 3);
const maxParallelSlots = 3;

const initialTokens: TokenBalance = {
  imagegenRemaining: null,
  codexRemaining: null,
  resetLabel: "Waiting for server",
};

function normalizeGeneratedImages(payload: unknown): Array<{ imageUrl: string; revisedPrompt?: string; durationMs?: number }> {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.imageUrl === "string") {
    return [{ imageUrl: record.imageUrl }];
  }
  if (typeof record.url === "string") {
    return [{ imageUrl: record.url }];
  }
  if (typeof record.base64 === "string") {
    return [{ imageUrl: `data:image/png;base64,${record.base64}` }];
  }
  if (record.image && typeof record.image === "object") {
    const image = record.image as Record<string, unknown>;
    const durationMs = typeof image.durationMs === "number" ? image.durationMs : undefined;
    if (typeof image.imageUrl === "string") {
      return [{ imageUrl: image.imageUrl, revisedPrompt: typeof image.revisedPrompt === "string" ? image.revisedPrompt : undefined, durationMs }];
    }
    if (typeof image.url === "string") {
      return [{ imageUrl: image.url, revisedPrompt: typeof image.revisedPrompt === "string" ? image.revisedPrompt : undefined, durationMs }];
    }
    if (typeof image.base64 === "string") {
      return [{ imageUrl: `data:image/png;base64,${image.base64}`, revisedPrompt: typeof image.revisedPrompt === "string" ? image.revisedPrompt : undefined, durationMs }];
    }
  }
  if (Array.isArray(record.images)) {
    return record.images.flatMap((image) => {
      if (!image || typeof image !== "object") {
        return [];
      }
      const item = image as Record<string, unknown>;
      const durationMs = typeof item.durationMs === "number" ? item.durationMs : undefined;
      if (typeof item.url === "string") {
        return [{ imageUrl: item.url, revisedPrompt: typeof item.revisedPrompt === "string" ? item.revisedPrompt : undefined, durationMs }];
      }
      if (typeof item.imageUrl === "string") {
        return [{ imageUrl: item.imageUrl, revisedPrompt: typeof item.revisedPrompt === "string" ? item.revisedPrompt : undefined, durationMs }];
      }
      if (typeof item.base64 === "string") {
        return [{ imageUrl: `data:image/png;base64,${item.base64}`, revisedPrompt: typeof item.revisedPrompt === "string" ? item.revisedPrompt : undefined, durationMs }];
      }
      return [];
    });
  }

  return [];
}

function formatDuration(durationMs?: number) {
  if (typeof durationMs !== "number") {
    return "";
  }

  return `${Math.max(1, Math.round(durationMs / 1000))}s`;
}

function App() {
  const [style, setStyle] = useState("editorial product photography, crisp lighting");
  const [selectedSize, setSelectedSize] = useState(sizePresets[0].value);
  const [font, setFont] = useState(fontOptions[0]);
  const [prompt, setPrompt] = useState(
    "A polished browser UI for an AI image generation console with elegant Japanese typography",
  );
  const [count, setCount] = useState(3);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [tokens, setTokens] = useState<TokenBalance>(initialTokens);
  const [isGenerating, setIsGenerating] = useState(false);
  const [notice, setNotice] = useState("Ready to generate through Codex App Server.");

  const activeSize = useMemo(
    () => sizePresets.find((preset) => preset.value === selectedSize) ?? sizePresets[0],
    [selectedSize],
  );

  const composedPrompt = useMemo(
    () => [
      prompt.trim(),
      `Style: ${style.trim()}`,
      `Use typography inspired by ${font}.`,
      `Canvas size: ${activeSize.width} by ${activeSize.height}.`,
    ].filter(Boolean).join("\n"),
    [activeSize.height, activeSize.width, font, prompt, style],
  );

  async function refreshTokens() {
    try {
      const response = await fetch("/api/codex/tokens");
      if (!response.ok) {
        throw new Error(`Token endpoint returned ${response.status}`);
      }

      const data = await response.json() as Partial<TokenBalance>;
      setTokens({
        imagegenRemaining: typeof data.imagegenRemaining === "number" ? data.imagegenRemaining : null,
        codexRemaining: typeof data.codexRemaining === "number" ? data.codexRemaining : null,
        resetLabel: typeof data.resetLabel === "string" ? data.resetLabel : "Live",
      });
      setNotice("Token balance refreshed from Codex app server.");
    } catch {
      setTokens(initialTokens);
      setNotice("Token balance endpoint is not connected yet. UI is ready for /api/codex/tokens.");
    }
  }

  useEffect(() => {
    void refreshTokens();
  }, []);

  async function generateSlot(index: number, requestId: string) {
    const response = await fetch("/api/imagegen/slot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId,
        index,
        total: count,
        prompt: composedPrompt,
        style,
        size: activeSize.value,
        width: activeSize.width,
        height: activeSize.height,
        font,
        count,
        quality: "medium",
      }),
    });

    if (!response.ok) {
      let message = `Imagegen slot ${index + 1} returned ${response.status}`;
      try {
        const body = await response.json() as { error?: string };
        if (body.error) {
          message = body.error;
        }
      } catch {
        // Keep the status-based message.
      }
      throw new Error(message);
    }

    const generated = normalizeGeneratedImages(await response.json());
    if (generated.length === 0) {
      throw new Error(`Codex App Server response did not include image data for slot ${index + 1}.`);
    }

    const result = generated[0];
    setImages((current) =>
      current.map((image, imageIndex) =>
        imageIndex === index ? {
          ...image,
          status: "done",
          imageUrl: result.imageUrl,
          revisedPrompt: result.revisedPrompt,
          durationMs: result.durationMs,
        } : image,
      ),
    );
  }

  async function handleGenerate() {
    if (!prompt.trim()) {
      setNotice("Main prompt is required before generation.");
      return;
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextImages = Array.from({ length: count }, (_, index) => ({
      id: `${Date.now()}-${index}`,
      status: "queued" as const,
    }));

    setImages(nextImages);
    setIsGenerating(true);
    setNotice(`Generating ${count} real images. Up to ${maxParallelSlots} slots run at once.`);

    let generatedCount = 0;
    let failedCount = 0;
    let nextSlot = 0;

    async function runWorker() {
      while (nextSlot < nextImages.length) {
        const index = nextSlot;
        nextSlot += 1;

        setImages((current) =>
          current.map((item, imageIndex) =>
            imageIndex === index ? { ...item, status: "generating" } : item,
          ),
        );
        setNotice(`Generating ${Math.min(nextSlot, count)} of ${count} through Codex App Server.`);

        try {
          await generateSlot(index, requestId);
          generatedCount += 1;
          setNotice(`Generated ${generatedCount} of ${count}.`);
        } catch (error) {
          failedCount += 1;
          const message = error instanceof Error ? error.message : "Generation failed";
          setImages((current) =>
            current.map((item, imageIndex) =>
              imageIndex === index ? { ...item, status: "error", error: message } : item,
            ),
          );
          setNotice(message);
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(maxParallelSlots, nextImages.length) }, () => runWorker()));

    setNotice(failedCount > 0 ? `Generated ${generatedCount}; ${failedCount} failed.` : `Generated ${generatedCount} real images through Codex App Server.`);

    setIsGenerating(false);
    await refreshTokens();
  }

  return (
    <main className="app-shell">
      <section className="creator">
        <header className="masthead">
          <div>
            <p className="eyebrow">Codex Imagegen</p>
            <h1>Image generation console</h1>
          </div>
          <button className="icon-button" type="button" onClick={refreshTokens} aria-label="Refresh token balance">
            <RefreshCw size={18} />
          </button>
        </header>

        <div className="layout">
          <form className="control-panel" onSubmit={(event) => { event.preventDefault(); void handleGenerate(); }}>
            <label className="field">
              <span><Palette size={16} /> Style</span>
              <input value={style} onChange={(event) => setStyle(event.target.value)} placeholder="e.g. soft watercolor, high contrast poster" />
            </label>

            <fieldset className="field">
              <legend>Size preset</legend>
              <div className="size-grid">
                {sizePresets.map((preset) => (
                  <label className="choice" key={preset.value}>
                    <input
                      checked={selectedSize === preset.value}
                      name="size"
                      type="radio"
                      value={preset.value}
                      onChange={() => setSelectedSize(preset.value)}
                    />
                    <span>{preset.label}</span>
                    <small>{preset.value}</small>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="field">
              <span><Type size={16} /> Font</span>
              <select value={font} onChange={(event) => setFont(event.target.value)}>
                {fontOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span><Sparkles size={16} /> Main prompt</span>
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={8} />
            </label>

            <fieldset className="field">
              <legend>Batch count</legend>
              <div className="count-grid">
                {countOptions.map((option) => (
                  <label className="count-choice" key={option}>
                    <input
                      checked={count === option}
                      type="checkbox"
                      onChange={() => setCount(option)}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <button className="generate-button" disabled={isGenerating} type="submit">
              {isGenerating ? <Loader2 className="spin" size={18} /> : <ImagePlus size={18} />}
              Generate {count} images
            </button>

            <p className="notice">{notice}</p>
          </form>

          <section className="results" aria-label="Generated images">
            {images.length === 0 ? (
              <div className="empty-state">
                <ImagePlus size={34} />
                <p>Generated images will appear here.</p>
              </div>
            ) : (
              images.map((image, index) => (
                <article className="image-tile" key={image.id}>
                  <div className="image-frame" style={{ aspectRatio: `${activeSize.width} / ${activeSize.height}` }}>
                    {image.status === "done" && image.imageUrl ? (
                      <img alt={`Generated result ${index + 1}`} src={image.imageUrl} />
                    ) : image.status === "error" ? (
                      <p>{image.error}</p>
                    ) : (
                      <Loader2 className="spin" size={28} />
                    )}
                  </div>
                  <footer>
                    <span>#{index + 1}</span>
                    <strong>{image.status === "done" ? <><Check size={15} /> {formatDuration(image.durationMs)}</> : image.status}</strong>
                  </footer>
                  {image.revisedPrompt ? <p className="revised-prompt">{image.revisedPrompt}</p> : null}
                </article>
              ))
            )}
          </section>
        </div>
      </section>

      <footer className="token-dock" aria-label="Token balance">
        <TokenMeter label="Imagegen tokens" value={tokens.imagegenRemaining} />
        <TokenMeter label="Codex tokens" value={tokens.codexRemaining} />
        <span className="reset-label">{tokens.resetLabel}</span>
      </footer>
    </main>
  );
}

function TokenMeter({ label, value }: { label: string; value: number | null }) {
  const normalized = typeof value === "number" ? Math.max(0, Math.min(100, value)) : 0;

  return (
    <div className="token-meter">
      <div>
        <span>{label}</span>
        <strong>{typeof value === "number" ? `${value}%` : "--"}</strong>
      </div>
      <meter min="0" max="100" value={normalized} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
