---
id: 01a14735-d6cd-7658-8195-0c15c4f1800d
title: "Claude Code's own question is read from the screen and answered with keys: the own-text row holds input and is not among the options"
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/adapter-anthropic/src/harness/screen.ts
---
Claude Code's own question (the AskUserQuestion tool) Tagma sees only on the screen: a plain thread has no hooks, and in the vendor transcript, while the question stood, the tool call had not yet appeared (measured on one live question). So the question travels the same road as permission screens: screen reader → thread question with `parent: true` → notification to the parent → `answer_approval` → keys into the TUI. One reader serves both plain and regular Claude terminal threads.

What the code does not say on its own — TUI behaviour measured on Claude Code 2.1.302:
- The last list row above the rule is the own-text row ("Type something."). Under the pointer it holds the input field: digits and letters go into the text, so the key plan first moves the pointer away from it. Typed text replaces its label, and the row is excluded from the question options — otherwise every typed frame would look like a new question.
- Single choice: an option digit selects and submits; a digit on the empty text row only moves the pointer into it, Enter submits the text. A digit on a row with a draft submits the draft, so such rows are reached with arrows.
- A pointer arriving in the text row puts the cursor at the start of the draft: Ctrl+K erases it whole, Backspace does nothing there. Without this, a new answer would glue itself to the old draft.
- Multiple choice (`[ ]`/`[✔]`): digits toggle the mark without moving the pointer, and do nothing while the pointer is on the Submit row. Enter on Submit submits. Mark state is read from the screen, and the plan toggles only what differs from the answer.
- Several questions go as tabs one at a time; after the last (and after multiple choice) comes the "Ready to submit your answers?" screen with no footer, answered with a digit. Each screen is a separate question to the parent. Which tab is current shows only in style, not in text; questions differ in text because the CLI refuses a call with repeated question text ("Question texts must be unique").
- "Chat about this" declines the question, and the CLI ends the turn.

Footer, rows and rule are the vendor's layout: a new CLI version that changed them will leave the question unrecognized again, and tests on captured screens catch that.
