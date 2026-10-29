---
id: 01a11804-c6c4-7f34-9aec-d3e07383424f
title: "A document session repaints from the touched line to convergence: line-start state is the only memory between lines"
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/highlight/src/document.ts
  - kind: file
    ref: packages/highlight/src/grammar.ts
---
A line's tokens are defined by its text and the TextMate-stack state at its start, so the session keeps one state per line (`states[k]` is line `k`'s start, `states[n]` the document end) and keeps no tokens: window lines recompute from states.

**Frontier and horizon.** `frontier` — states `0..frontier` verified for the current text; `horizon` — how far states are set at all (hints of the former text shifted by edits). The first pass moves the horizon too, so past it there are no hints. An edit replacing `[from,to)`: the frontier rolls back to `from`, room for inserted lines empty, and the state at the line start after the insertion kept as a hint. The pass stops when a line end equals the hint (`StateStack.equals`) and the line sits past every unpassed edit (`dirtyEnd`); then the frontier jumps to the **horizon**, not the file end — past the horizon nothing to verify against, the pass moves on. Deleting lines (`m = 0`) also requires passing the line that takes `from`'s place.

**What arrives.** Window lines `viewport(from, to)` arrive at once if their states verified (`owed` — the window's not-yet-sent part), and as the pass goes if not; a window request never lost even if the pass jumped over it. Window lines recomputed by the pass sent again. Lines outside the window unsent and no tokens built for them — only the final stack needed; after an edit the client counts colors outside the window stale and requests the window on scroll. The window set in current-text coordinates: after an edit shifting lines, `viewport` called again. `settled` stands on the answer the pass ended with. The version in the answer is the version the colors computed under.

**Refusals.** `plain` — the language has no grammar (`text`, `ansi`, unknown name): no session started. `failed` — grammar or wasm failed to load, repeated `open` of the same id, or a worker failure; a failed load not cached. `refused` — an edits batch breaks order, range or line (the `checkLineEdits` check from `@runlith/files/lines`, same as `applyLineEdits`); the document stays as before.

**Whole-text coloring equality.** An empty line and a line past `HIGHLIGHT_LINE_CHAR_CAP` change no state and have no tokens; lines cut on `\n` as in the whole-text path (`splitLines`/`lineBody`; the session also strips BOM); colors from the same theme, and the session, like shiki, returns its variable colors through `colorReplacements`: the `vscode-textmate` color map keeps hex only. The whole-text shiki singleton lazy-loads built-in "lazy" languages only as other languages load, while the session takes them from the kit's language table at once — so code blocks in markdown and `lang="scss"` in svelte color independently of what colored before.

**Lines.** The session cuts text like `LineEdit` (`splitBodies`: k newlines → k + 1 lines, no BOM), so an answer's line number is the editor's line number.

**Why not a shiki wrapper.** shiki's `GrammarState.getInternalStack` marked `@internal`; the session builds a `Registry` from `shiki/textmate` (re-export of the public `@shikijs/vscode-textmate` API) on the same language registrations and theme.
