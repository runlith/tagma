---
id: 01a117dd-98e5-7df2-86cb-e3f13b5e7d6f
title: "Checkout files as in VS Code: tree, tabs, editing with autosave, Cmd+P, and file search"
ord: 9
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a1166f-7113-7752-b6b9-0a71c16f87cd
  - kind: relates
    to: 01a117dd-98e5-7df2-86cb-e3f29496f66b
  - kind: relates
    to: 01a117dd-98e5-7df2-86cb-e3f30d632257
---
The operator sees and edits any project file the same way as in VS Code or Orca, without leaving Tagma, while agents keep writing into the same checkout. Operator edits are the operator's own lines: they show as "You", never slide into an agent commit, and leave with the operator's commit.

## What the operator gets

- A checkout **tree** with git letters, dimmed ignored paths, and line-holder dots (thread or "You").
- **Tabs**: a preview tab on single click, pinned tabs, restore with cursor and scroll, Cmd+Shift+T.
- **Editing** with autosave configurable as in VS Code (`editor.autoSave`: off, after delay, on editor focus loss, on window focus loss; off by default as in VS Code, with a one-second delay for the "after delay" mode) and always with Cmd+S. Agent edits in an open file merge around the cursor; only an edit touching the same lines asks.
- **File operations**: create, rename, move, delete — no confirmations, each undone by Cmd+Z.
- **Cmd+P** with the VS Code scorer and `:line`, **file search** (Cmd+Shift+F) streaming, with regex, case, word, and globs.
- **Git diff** with the same editor: numbers, the line holder in the gutter, an overview ruler instead of a minimap, "Open file at this line".
- **Paths from chat and terminal** open the file at the line.

## Where

The `checkout` surface becomes the code workplace of one checkout: the left column holds Files | Search | Git views, on the right one tab area (file, diff, picture, markdown preview). No new surface. The checkout is the one picked by `GraphAim` (`?branch=`), as the Git tab and status bar do; a tab carries its own `rootId`, so a file from a thread's worktree opens in its own checkout. The thread stage in chat draws the same editor. Details in [[b51edd1b]].

## Decisions

- **Engine — CodeMirror 6** in the [[1759d27d]] kit. It takes foreign highlighting as decorations, maps outside edits as a transaction, and is six times smaller than Monaco; `@pierre/diffs` offers no authorship column and does not take server `spans`. Measurements and comparison in [[0d632257]].
- **Highlighting is shiki alone**, moved into the [[413c99cc]] kit. An edited document is repainted in a worker from the touched line to convergence, not whole.
- **The server computes the diff** (`read_authorship`); the editor only draws it. `@codemirror/merge` is not taken — nobody merges by hand; agents do merging and conflicts.
- **The operator is a line holder** on par with a thread ([[eefb0e60]], part of [[c16f87cd]]). Leaving them holderless is forbidden: holderless lines travel with an agent landing per [[3595190e]]. A stub thread will not do either: a thread has a run, a status, and a list place.
- **Writes are line-based**: base digest and line edits; the server lays them over the file bytes. CRLF, BOM, missing trailing newline, mode, and symlinks of untouched places are preserved byte-for-byte. A write travels the same intake road as agent tools: a queue per path, fact before file, CAS.
- **An outside edit of an open file lands outside the operator's undo**: otherwise Cmd+Z with autosave would roll an agent's lines back under the operator's name. Here we diverge from both: VS Code and Orca put reload into undo.
- **Deletion goes to the Tagma trash** inside the checkout's git directory, with one-rename undo. Orca and VS Code put it into the OS trash through Electron; with Tagma deletion is a server operation that must write line facts in the same act, and an OS trash needs an adapter per OS and gives no portable undo. No confirmations (0f144655): deletion is undone, not confirmed.
- **Markdown** opens in CodeMirror with preview (Cmd+Shift+V), as in VS Code. Orca's rich mode on our TipTap kit is not taken: its reconcile exceeds 50,000 characters and rewrites the file with canonical markdown on an unapplied patch, and while the field has focus an agent's outside edit is overwritten (`packages/markdown-editor/src/reconcile.ts`, `MarkdownEditor.svelte`).
- **The chat feed is untouched.** Edit diffs, read files, and code in messages stay on the current renderer: an editor in a virtualized feed line is expensive and breaks height measurement.

Orca and VS Code behavior it was checked against in [[9496f66b]].

## Owners

| Owner | What | Spec |
|---|---|---|
| `@runlith/highlight` (new kit) | shiki, languages, themes, worker, whole-text highlighting and edited-document sessions | [[413c99cc]] |
| `@runlith/files` | content detection, CAS write, write fact, line edits | [[bcb8266a]] |
| `@runlith/ripgrep` | binary, search launch, and output parsing | [[bcb8266a]] |
| `@runlith/code-editor` (new kit) | document with rebase, editor, diff, gutters, overview ruler | [[1759d27d]] |
| change-record | operator as holder, intake of their writes | [[eefb0e60]] |
| workspace | `CheckoutWatch` — one watcher per checkout | [[9c88344d]] |
| `checkout-files` (new server module) | listing, path index, search, live document, operator writes and file operations, trash | [[9c88344d]], [[588b85a5]] |
| app, `features/files` and `features/checkout` | tabs, tree, autosave, conflict, palette, path opening | [[db56abc2]], [[588b85a5]], [[b51edd1b]] |

Direction: app → `@runlith/code-editor` → `@runlith/highlight`, `@runlith/files`; `checkout-files` → change-record, workspace, kits. `@runlith/markdown` becomes a consumer of `@runlith/highlight`. Protocol with the server, tabs, and mark meanings are the app's; the editor kit does not know them.

## Per-event cost

| Event | Work |
|---|---|
| agent edits an open file | one path from `CheckoutWatch` → stat, read, and line diff of only that path, one frame to each of its subscribers; the tree untouched |
| agent creates a file | a tree frame with one directory; the path index updates with one `git ls-files` batch |
| a command writes thousands of files in an ignored directory | frames only for expanded directories; the index does not take them |
| lost watcher or overflow | `rescan`: the client re-reads expanded visible directories, document cells recheck stats, the index rebuilds |
| typing a character | repaint from the touched line to convergence in a worker; the write is line edits, not a file |

No single-path event re-reads everything (2393aff1); the consumer has no debounce — the producer folds paths.

## Order

1. At once and in parallel: [[413c99cc]], [[bcb8266a]], [[9c88344d]].
2. [[1759d27d]] — after [[413c99cc]] and [[bcb8266a]].
3. [[db56abc2]] — after [[1759d27d]] and the S6 client ([[d50da88f]]): both edit the Git tab.
4. [[b51edd1b]] — after [[db56abc2]] (both edit `CheckoutPage.svelte`) and [[9c88344d]].
5. [[eefb0e60]] — after the S6 server ([[e0d6c64f]]): otherwise the `Hand` wire changes under two works at once.
6. [[588b85a5]] — last: it joins editor, server, and the operator-holder.

Intersections with the running work on [[c16f87cd]] coordinate only when editing the same lines (3d635aff).

## Out of v1

- Replace across files: agents do bulk edits; Orca has none. Single-file replace exists.
- Rich markdown — a separate spec with conditions: reconcile refuses instead of canonizing, the same live document protocol, shiki.
- Files over 16 MiB (`versionContentLimit`): a stub with size. Above the limit a write holds no texts and lines are not attributed.
- Compact directories, graph-note marks in the gutter, "commit only mine", drop from Finder, mobile layout — second wave.
- Edits from the operator's own terminal stay holderless. Whether its command windows become operator-holder windows is a separate question.
- A checkout outside the server filesystem (sandbox guest): operations refuse with a reason.
