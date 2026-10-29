---
id: 01a117dd-98e5-7df2-86cb-e3f4413c99cc
title: "@runlith/highlight kit: shiki moves out of @runlith/markdown, and the edited document repaints from the touched line to convergence"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/highlight/src/colours.ts
  - kind: file
    ref: packages/highlight/src/offThread.ts
  - kind: file
    ref: packages/highlight/src/worker.ts
---
A file being edited paints at once and without flashing with the same shiki as diff, chat, and graph bodies, and typing a character costs repainting a few lines, not a file.

## What stands now

- shiki, languages (22, lazily), themes github-dark/light-default, line limits, and the worker live in `@runlith/markdown`: `packages/markdown/src/codeHighlight.ts`, `highlightOffThread.ts`, `highlight.worker.ts`.
- Consumers: `markdown/src/render.ts`, `apps/tagma/app/src/lib/features/graph/CodeBody.svelte`, `features/checkout/AuthoredDiff.svelte`, `features/threads/native/Conversation.svelte`.
- The worker paints whole text: 32,000-character slices with `GrammarState` passing; viewport-first and edits do not exist.

A code editor depending on the markdown kit points the wrong way; so highlighting moves to its own kit.

## The `@runlith/highlight` kit

**Owns:** languages, aliases, themes, line limits, the worker, the whole-text API (as now), and document sessions.

**A document session** in the worker:
- `open(id, text, lang, theme)`, `edit(id, version, edits: LineEdit[])`, `viewport(id, from, to)`, `close(id)`; `LineEdit` comes from `@runlith/files/lines` ([[bcb8266a]]), so sessions wait for that file, while moving the highlighting out does not.
- Holds lines and the grammar state at each line start; does not hold tokens — window lines repaint from saved states, cheaper than memory for all file tokens.
- `edit` retokenizes from the first touched line and stops once the end-of-line state matches the old one — like VS Code's TextMate tokenization. A new edit cancels an unfinished one and starts from the smallest touched line. The pass runs in order from the front: a line's state depends on the previous ones.
- The answer is `colours {id, version, from, to, lines, settled}` for lines of the current `viewport` only; `settled` means the pass is done. Lines outside the window are not sent: the client asks for the window on scroll. A window request is never lost: even when the pass converged before the window, the window is still answered.
- A grammar, theme, or engine load failure reaches the client session as a refusal with a reason, not empty highlighting; a language without a grammar is an explicit "no highlighting" answer.

**The session engine** is the public `@shikijs/vscode-textmate` API already standing under shiki: a `Registry` with shiki grammars and themes (`setTheme`, `getColorMap`), `tokenizeLine2` from the previous line's state, and `StateStack.equals` for convergence. VS Code paints incrementally the same way (`vscode-textmate` in a worker, `editor.experimental.asyncTokenization`) and so does Orca (`lib/monaco-languages/textmate-token-provider.ts`). shiki's internal methods (`GrammarState.getInternalStack`, the highlighter's `setTheme` — both `@internal`) are not used: a shiki update may remove them.

## Card (`set_module`)

- id `@runlith/highlight`, kind kit, dir `packages/highlight`.
- entries: `src/colours.ts` (languages, themes, whole-text tokens), `src/offThread.ts` (whole-text API), `src/session.ts` (document sessions).
- imports: `@runlith/files` (only `lines.ts`).
- order: `colours` → `worker` → `offThread`, `session`.
- c686d8c2 Markdown: imports + `@runlith/highlight`, entries lose three files, the body gains "…and paints code through `@runlith/highlight`".

## Removed

Three files from `packages/markdown/src` move (not copied); consumer imports switch to the new kit.

## Acceptance

The executor proves with session-contract tests:
- editing one line in a 10,000-line file retokenizes O(1) lines — by tokenized-line count, not answer lines;
- an open `/*` at the start repaints to the end, a closed one converges;
- session tokens after a series of edits equal the whole-text highlighting of the same text.

Typecheck, tests, and inspections green; chat, graph bodies, and Git diff paint as before.
