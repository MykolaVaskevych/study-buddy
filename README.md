<p align="center"><img src="docs/logo.png" width="128" alt="Study Buddy logo"></p>

<h1 align="center">Study Buddy</h1>

Turn theory-heavy PDFs (lecture slides, notes, textbooks) into an exam plan you can actually finish.

- **Reads any PDF**, including image-only slides and formula-heavy pages. The AI sees each page, not just its text.
- **Page notes:** summary, key points, concepts and formulas with symbol tables.
- **Read → test loop:** "Test me" on the page you just read, prepared in the background so it's instant.
- **Flashcards with spaced repetition (FSRS)** that plan reviews around your exam date. Essentials deck or full deck, with cloze and formula cards.
- **Quizzes and timed mock exams** with verified answer keys, numeric problems with units, and explanations that link back to the page. "From the book" quizzes reuse the book's own exercises.
- **Exam triage planner:** give it your time and a target score. It picks what to learn fully, what to learn only at core level, and what to skip (long, hard, low-value topics), and shows the expected score, a reason per topic, and a day-by-day schedule. Past exam papers recalibrate the topic weights.
- **Tutor chat** about your book, with answers that cite pages (`[p. 14]` jumps there). One-click "explain simply", "exam answer" and "worked example" for the page you're on.
- **Cheat sheet:** a printable one-page summary of the core formulas and concepts per topic.
- **Anki export** of your cards (Basic + Cloze, math included).

Works with your **Claude subscription** through a local Claude Code login, so there are no API costs. You can also use your own Anthropic API key.

> Status: v0.1, usable. [Project overview](docs/OVERVIEW.md) · [Architecture](docs/ARCHITECTURE.md)

## Development

```bash
npm install
npm run dev      # run the app
npm run check    # typecheck + lint + format + tests
npm run smoke    # build and launch once
```

To use the Claude subscription provider, install [Claude Code](https://claude.com/claude-code) and log in once (`claude`).

## Install

From [Releases](https://github.com/MykolaVaskevych/study-buddy/releases):

- **Linux**: `.flatpak` (open it with Discover / GNOME Software, or `flatpak install --user study-buddy.flatpak`), AppImage, `.deb`, or `.pacman` (Arch: `sudo pacman -U study-buddy-*.pacman`).
- **Windows**: `Study Buddy Setup *.exe` (unsigned, so SmartScreen asks once: _More info → Run anyway_).

The default AI provider uses your Claude subscription through an installed, logged-in [Claude Code](https://claude.com/claude-code); check it with `study-buddy --check-ai`. You can switch to an Anthropic API key in Settings instead.

Build packages yourself: `npm run dist:linux` (AppImage + pacman in `release/`).

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
