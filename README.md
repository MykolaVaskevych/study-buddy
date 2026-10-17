# Study Buddy

Turn theory-heavy PDFs (lecture slides, notes, textbooks) into an exam plan you can actually finish.

- **Reads any PDF**, including image-only slides and formula-heavy pages. The AI sees each page, not just its text.
- **Page notes:** summary, key points, concepts and formulas with symbol tables.
- **Read → test loop:** "Test me" on the page you just read, prepared in advance so it's instant.
- **Flashcards with spaced repetition (FSRS)** that plan reviews around your exam date. There's an essentials deck and a full deck.
- **Quizzes and mock exams** with verified answer keys, numeric problems and explanations that link back to the page.
- **Exam triage:** give it the time you have and a target score. It picks what to learn fully, what to learn only at core level, and what to skip (long, hard, low-value topics), and shows the expected score and why.

Works with your **Claude subscription** through a local Claude Code login, so there are no API costs. You can also use your own Anthropic API key.

> Status: early development. See `docs/ARCHITECTURE.md`.

## Development

```bash
npm install
npm run dev      # run the app
npm run check    # typecheck + lint + format + tests
npm run smoke    # build and launch once
```

To use the Claude subscription provider, install [Claude Code](https://claude.com/claude-code) and log in once (`claude`).

## Install (Linux)

Download the AppImage, `.deb` or `.pacman` from [Releases](https://github.com/MykolaVaskevych/study-buddy/releases). On Arch: `sudo pacman -U study-buddy-*.pacman`.

The default AI provider uses your Claude subscription through an installed, logged-in [Claude Code](https://claude.com/claude-code). Check it with `study-buddy --check-ai`. You can switch to an Anthropic API key in Settings instead.

Build packages yourself: `npm run dist:linux` (AppImage + pacman in `release/`).
