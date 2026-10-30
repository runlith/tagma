---
id: 01a16fb1-7502-7bab-b3c8-77090b7d88cc
title: The Claude Code screen-question window with the "CLI no longer shows the question" outcome cannot be closed, its buttons do nothing, and it is not in Tagma style
ord: 124
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16fa9-795a-7924-8880-524dc3ba5fa9",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/adapter-anthropic/src/harness/screen.ts
  - kind: file
    ref: packages/agent/src/thread/run/RoutedAnswers.ts
---
Reproduction (2026-10-24): at start, the CLI showed the `harness:claude-code` thread [[01a16fad-e510-7218-b497-cd3eb104179b|claude-code-motion]] its folder-trust screen ("Accessing workspace… Yes, I trust this folder / No, exit"). The screen reader raised it as a question to the parent (`harness-screen:50a418eb-…`), the parent answered `answer_approval` with "Yes, I trust this folder". The CLI accepted the answer: the thread kept working and delivered a report.

What the operator sees: a modal window hangs over the thread terminal with the question text and the line "The CLI no longer shows this question; the answer is kept until it is asked again." Neither "No, exit" nor "Yes, I trust this folder" does anything; the window cannot be closed.

What the code says: the line is `GONE` in `packages/agent/src/thread/run/RoutedAnswers.ts`. With the `gone` delivery outcome the question stays `status: 'open'` with this note, so the interface keeps showing it open, and a repeated answer goes to `gone` again. Unverified: why the answer that reached the CLI was classified as `gone` rather than `delivered` (probably the screen changed before delivery re-read it).

Done when:
- an answer to a screen question the CLI accepted is recorded as answered, and the window dismisses itself;
- a question the CLI genuinely no longer shows does not hold the operator: the window closes, blocks nothing;
- the question window is built in Tagma style (tokens `apps/tagma/app/src/app.css`, app components), not as a raw CLI screen dump with grey text and bare buttons;
- the defect test goes through the same door as the real call (screen question → `answer_approval` → delivery outcome), and fails on this scenario before the fix.
