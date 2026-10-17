# Study Buddy: overview

## The problem

Many students already ask an AI to turn lectures into study material. The author did exactly that for a networks course and got two "study books" of 146 and 300 pages: the original slides with explanations, worked examples and exam traps in between.

Good material isn't the same as being ready for the exam. With 446 pages and four days left, the real questions are: what do I study, what can I skip, and do I actually know this page?

## What Study Buddy does

Study Buddy takes those materials (or any PDF) and turns them into an exam plan you can finish.

- **Reads every page.** The AI sees each page as an image as well as text, so slides, diagrams and formulas count. Every page gets notes: a summary, key points, concepts, formulas with each symbol explained, and exam signals such as traps and practice questions.
- **Read → test.** After a page, "Test me" asks 3–5 questions on exactly that page. Feedback is grounded in the material and points back to the page. It even catches mistakes in the source slides.
- **Exam triage.** Give it the exam date, your hours per day and a target score. For each topic it picks Full, Core (essentials only) or Skip, and gives the reason ("Skipped: ~1 h 15 m for ~5 % of marks"). It shows the expected score, says honestly when the target isn't reachable, and builds a day-by-day schedule. It re-plans after every quiz, and past exam papers recalibrate the topic weights.
- **Remember it.** Spaced-repetition flashcards, timed so every card comes back before the exam, plus Anki export.
- **Ask.** A tutor chat whose answers cite pages (`[p. 102]` jumps there), and one-click "explain simply", "exam answer" and "worked example" for any page.
- **Last evening.** A printable one-page cheat sheet of the core formulas and concepts per topic.
- **No learning curve.** A short guided tour on every screen.

## Why it is different

- **Trustworthy.** Every generated item cites its source page and is checked against the page text. Answer keys are verified by a second, blind pass.
- **Honest about time.** It's the only study tool here that tells you what _not_ to study, and why.
- **Free to run for subscribers.** It works with an existing Claude subscription through Claude Code, so there are no API bills. You can also bring an Anthropic API key.
- **Local-first.** PDFs and progress stay on your machine.

## Under the hood

- Electron + TypeScript + React.
- SQLite with full-text search.
- pdf.js and pdf-lib.
- The FSRS spaced-repetition algorithm.
- An exact knapsack solver for the triage.
- Claude: Haiku for bulk page reading, Opus for questions and tutoring.

There are 860+ automated tests, and a full-flow smoke test runs in CI and on the packaged Linux builds (AppImage, pacman, deb).

Measured on the real 146-page course book: indexing plus the course map took 4.4 minutes. Generated cards and page-check questions were 100 % evidence-verified, with no trivia.

## What's next

- **Make the materials too.** Generate the study book itself (explanations, worked examples, exam traps between the slides) from raw lecture slides, then study it in the same app. See [the issue](https://github.com/MykolaVaskevych/study-buddy/issues/36).
- Copy-restricted PDFs, mobile review and sync.
