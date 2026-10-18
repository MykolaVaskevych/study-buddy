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

## What's new and tours (automatic, keep it that way)

- The in-app "What's new" is generated at build time from `feat:`/`fix:` commits (`build-tools/whatsnew.ts`), grouped by `v*` tags. Write the squash-merge subject for users, and add a line `What's new: <one friendly sentence>` to the body of user-facing changes. Plumbing goes under internal scopes (`app`, `main`, `ci`, `build`, `release`, …), which are hidden.
- Every new visible feature gets a tour step (`features/tour/tours.ts`). Returning users are shown only the steps they haven't seen; nothing else is needed.

## Git workflow

- Branch `feat/<area>` or `fix/<topic>` from `main`. Use Conventional Commits (`feat(planner): ...`).
- Open the PR with `gh pr create --base main`. Link the issue (`Closes #N`) and describe what / why / how it was tested.
- CodeRabbit reviews PRs (`.coderabbit.yaml`). Until the repo has 10 stars it only reviews on request, so after opening a PR comment `@coderabbitai review`. Address its findings, or reply with the reason you didn't, before merging.
- Squash-merge after review and green CI. When a subagent team works on the repo, the lead reviews and merges agent PRs. When one agent works alone, it self-reviews the diff and merges its own PR once CI is green.
