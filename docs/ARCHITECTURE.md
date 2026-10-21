# Architecture

Study Buddy is an Electron + TypeScript desktop app. It turns theory-heavy PDFs into exam prep: page notes, flashcards (FSRS), page checks, quizzes, mock exams, and an **exam triage planner** that decides what to skip when time is short.

## Layers

```
src/shared/    PURE TypeScript: no node, electron, react, SDK or DB imports.
               domain.ts            domain model (page numbers are 1-based absolute PDF pages)
               settings.ts          settings schema + defaults
               ipc/contract.ts      every renderer<->main channel: zod input + output type
               ai/provider.ts       LlmProvider interface + AiError
               ai/schemas.ts        zod schemas of model outputs (structured outputs)
               planner/             exam triage solver + schedule (pure, heavily tested)
               grading/             deterministic graders (mcq, multi, tf, numeric)
src/main/      Electron main process (Node). One folder per concern:
  index.ts     composition root: open DB, create services, register IPC, create window
  ipc/         ONLY place that uses ipcMain; validates input with the contract, returns envelopes
  db/          ONLY place importing better-sqlite3 / drizzle; repositories (db/types.ts)
  library/     PDF import: hashing, text/outline extraction (worker thread), chunk PDFs
  ai/          ONLY place importing AI SDKs: providers, prompts, quality checks (ai/types.ts)
  jobs/        persistent background queue (jobs/types.ts)
  srs/         ts-fsrs wrapper, deadline-aware (srs/types.ts)
  pipelines/   orchestration: import -> index -> topics -> generators; persists via db
src/preload/   generic typed bridge: window.api.invoke / window.api.on
src/renderer/  React UI. Talks to main ONLY through src/renderer/src/api/client.ts.
               Runs in a plain browser with a mock api for fast UI work.
```

ESLint enforces the import rules (`no-restricted-imports` in `eslint.config.js`). Modules depend on the **interfaces** in their `types.ts`, never on another module's internals. Wiring happens only in the composition root.

## Data flow

1. **Import (instant, no AI).** `library.importPdf` hashes the file and copies it to `<userData>/library/<sha>.pdf`. A worker extracts per-page text, labels and the outline, then builds a grid of 10-page chunk PDFs. Every chunk page gets a small `SB-PAGE <n>` stamp, so the model always sees absolute page numbers. Pipelines persist the pages, and FTS5 makes the text searchable right away.
2. **Index pass (background, `fast` tier).** One structured-output call per chunk returns the page kind, a summary, key points, concepts and formulas (with importance), exercises and exam signals. The chunk the reader is on goes first. The pass is resumable.
3. **Topic map (`smart` tier, text only).** Built from page digests plus the outline. Gives topics with page ranges, prerequisites, difficulty, exam weight (with reasons), core fraction, and core/full minutes.
4. **Generators (`smart` tier, on demand, everything stored).** Flashcards (essentials and full), page checks (prefetched), quizzes, mock exams. Each item cites its source pages and carries an evidence quote that is checked against the page text. Answer keys are verified by a blind second pass.
5. **Learning loop.** FSRS reviews (deadline-aware) and quiz attempts update topic mastery (a Beta belief). The planner re-solves.

**Courses and sources.**

- **Courses.** A course (`courses` table) groups files. Every document belongs to one course. Plans, cards and topics are still per document; a cram can span several files of a course.
- **Office files.** PowerPoint, Word and OpenDocument files are converted to PDF at import by the user's LibreOffice (`library/office.ts`; on the host when running in the Flatpak). A source-hash note makes re-imports reuse the stored PDF.
- **Study portal.** `/portal` is an Electron `WebContentsView` on the persistent partition `persist:portal`, laid over the screen's placeholder (`portal/view.ts`).
  - Students sign in on the site itself; the app never sees the password.
  - Study-file downloads are imported into the chosen course (`pipelines/portal.ts`).
  - Pages are untrusted: no preload, sandboxed, every permission denied, http(s) only.

## AI providers

Claude Code's own login is driven from Settings through `claude auth status --json` / `login` / `logout` (`ai/providers/claude-code/auth.ts`): without a terminal the CLI opens the browser and reads the one-time code from stdin, so sign-in is two IPC calls (`ai.claudeLogin`, `ai.claudeLoginCode`). The app never sees the credentials.

| Provider                | Auth                                                      | Notes                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude-code` (default) | the user's Claude subscription (Claude Code login)        | `@anthropic-ai/claude-agent-sdk` `query()` with `tools: []`, `settingSources: []`, `strictMcpConfig`, `persistSession: false`, `outputFormat: json_schema`; PDFs sent as base64 `document` blocks through streaming input. Models: `haiku` / `opus`. Rate limits → `AiError('rate_limited')` → the queue pauses.                                                                                               |
| `anthropic-api`         | BYOK key (stored with Electron `safeStorage`)             | `@anthropic-ai/sdk`, structured outputs (`output_config.format`), prompt caching on chunk documents, `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) on Opus. Models: `claude-haiku-5-5` / `claude-opus-5-5`.                                                                                                                                                                                  |
| `codex`                 | the user's ChatGPT plan via the Codex CLI (`codex login`) | One `codex exec --json --output-schema` per call in an empty folder, read-only sandbox, `--ephemeral`, without the user's config; prompt on stdin, answer from `-o`. Text only like `openai-compatible`. Device sign-in (`codex login --device-auth`) is driven from Settings. Usage is notional.                                                                                                              |
| `openai-compatible`     | none for local servers; optional key (`safeStorage`)      | Plain `fetch` to `/v1/chat/completions` (SSE). Presets: Ollama, LM Studio, llama.cpp, DeepSeek, OpenRouter (`src/shared/ai/connections.ts`). Text only: PDF parts become their text layer via `library.pageTexts` with `[SB-PAGE n]` markers, image-only pages flagged. Structured output tries `json_schema` → `json_object` → prompt-only, validates with zod and asks once for a repair. Local runs cost 0. |
| `fake`                  | none                                                      | deterministic outputs for tests and `--smoke`                                                                                                                                                                                                                                                                                                                                                                  |

PDF text is untrusted input. The model gets no tools, rendered markdown is sanitized (no raw HTML) under a strict CSP, and keys never leave the main process.

## Exam triage planner

`src/shared/planner` holds pure functions.

- **Levels:** every topic gets `skip`, `core` or `full`.
- **Value:** `core` is worth `examWeight × coreFraction × p(core)`, and `full` is worth `examWeight × p(full)`. `p` comes from the mastery belief.
- **Cost:** the remaining minutes from the estimates, calibrated by the user's measured reading speed.
- **Solver:** a multiple-choice knapsack using dynamic programming over 15-minute slots. Modes are `max_score` (best score within the time) and `min_time` (least time for the target score).
- **Constraints:** prerequisites of a chosen topic are forced to at least `core`, and user overrides always win.
- **Output:** expected score, level per topic with a one-line reason, and a day-by-day schedule: learn → check → spaced review → mock exams near the exam date.

## Testing (no Playwright)

- `npm run check` runs typecheck, lint, prettier and Vitest. Vitest runs inside Electron's Node, so native modules match.
- Unit tests cover pure logic (planner, graders, srs, page mapping, grounding).
- Integration tests use real SQLite, the generated fixture PDF (`tests/fixtures/make-fixture-pdf.ts`) and the `fake` provider.
- UI tests use @testing-library/react in happy-dom.
- `npm run smoke` builds the real app and runs it with `--smoke`. It exits 0 or 1, and runs under `xvfb-run` in CI.
- `npm run eval` runs a local quality eval on real PDFs through the subscription. It is never run in CI.
