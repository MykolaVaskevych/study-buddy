# Study Buddy — working rules

Read `docs/ARCHITECTURE.md` first. Below are the rules every contributor and agent follows.

## Commands

- `npm run dev` runs the app with hot reload.
- `npm run check` runs typecheck, lint, prettier and tests. **It must pass before every push.**
- `npm test` runs Vitest only (inside Electron's Node, via `ELECTRON_RUN_AS_NODE=1`).
- `npm run smoke` builds the app and runs it with `--smoke` (exits 0 or 1).
- Use npm. Do not use Playwright: it does not work on the maintainer's Arch machine. Test UI with @testing-library/react + happy-dom.

## Code rules

- **Contracts first.** Code against the interfaces in `src/shared/**` and `src/main/*/types.ts`. A contract change must be small and additive, and called out in the PR description.
- **Layers** are enforced by ESLint. `src/shared` stays pure TS. Only `src/main/ai` imports AI SDKs, only `src/main/db` imports the database, only `src/main/ipc` uses `ipcMain`. The renderer talks to main only through `api/client.ts`.
- TypeScript is strict. No `any`, no `@ts-ignore`, no non-null assertions in app code. Errors are typed (`AiError`, `LibraryError`, `ApiError`).
- Keep functions small and pure where possible. Inject dependencies (clock, ids, provider, db) so they are testable. Don't use singletons.
- Page numbers are always 1-based **absolute** PDF pages. Dates are ISO strings across IPC.
- Model outputs are validated with the zod schemas in `src/shared/ai/schemas.ts`. Use `z.strictObject` and `.nullable()`, never `.optional()`.
- No stubs or TODOs left behind silently. If something is out of scope, open an issue and reference it.
- Never commit PDFs (copyright). Tests generate their fixture with `tests/fixtures/make-fixture-pdf.ts`.
- Comment density: explain _why_, not _what_. Doc-comment the exported functions.

## Tests

- Every new piece of logic gets unit tests next to it (`*.test.ts`).
- Integration tests use `:memory:` SQLite, the fixture PDF and the `fake` provider. No network in tests. Live AI tests run only with `LIVE=1`.

## Git workflow

- Branch `feat/<area>` or `fix/<topic>` from `main`. Use Conventional Commits (`feat(planner): ...`).
- Open the PR with `gh pr create --base main`. Link the issue (`Closes #N`) and describe what / why / how it was tested.
- Squash-merge happens after lead review and green CI. Don't merge your own PR.
