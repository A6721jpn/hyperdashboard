# Slide Builder

Browser interface for turning a prompt into a Google Slides creation request.

The default deck style is the no-zabuton editorial baseline: open typography,
generous whitespace, native rules/rails, direct labels, and only necessary
frames around real artifacts. User prompts are treated as flavor on top of that
baseline, not as permission to fall back into card grids, boxed prose, or fragile
space-aligned diagrams.

The app is built around the Codex + Google Slides workflow researched in
`notes/google-slides-codex-best-practices.md`:

1. Capture a structured brief.
2. Generate a slide-by-slide plan.
3. Send a Codex turn that asks for a local PPTX draft, native Google Slides import,
   connector readback, and thumbnail QA.
4. Stream the result back to the browser and surface the final Google Slides link.

## Run

```powershell
npm install
npm run dev
```

Then open:

```text
http://localhost:46310/
```

Set `SLIDE_BUILDER_MOCK_CODEX=1` before starting the server to use mock build
responses without launching `codex app-server`.
