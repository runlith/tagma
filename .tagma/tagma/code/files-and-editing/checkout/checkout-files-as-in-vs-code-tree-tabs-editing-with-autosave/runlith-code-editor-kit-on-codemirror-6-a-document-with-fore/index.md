---
id: 01a117dd-98e5-7df2-86cb-e3f61759d27d
title: "@runlith/code-editor kit on CodeMirror 6: a document with foreign-edit rebase, editor, server-answer diff, holder gutters, and overview ruler"
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a117dd-98e5-7df2-86cb-e3f30d632257
---
A VS Code-level editor and diff view in one CodeMirror 6 kit: a 100,000-line file opens without delay, agent edits merge into an unsaved buffer, deleted lines never reach copying. Why CodeMirror in [[0d632257]].

## The kit owns

- **`TextDocument`** — one document for many views: base, unsaved edits (`ChangeSet` off base), undo history.
  - `applyRemote(edits, digest)` — a disk edit onto a clean buffer, with `addToHistory: false`: Cmd+Z undoes only operator edits. A dirty buffer takes foreign edits only through `rebase`.
  - `rebase(theirs, digest)` → `applied` | `conflict {ranges}` | `refused`; a conflict is only when their ranges intersect ours in base coordinates.
  - `pending()` → a `{edits, digest}` snapshot for writing; `settled(snapshot, digest)` after it accepts the same snapshot.
  - Document lines are parts between `\n` (a lone CR is line content), as `LineEdit` has them [[bcb8266a]]: editor, server, and highlight-session line numbers agree.
- **`Editor.svelte`** — `EditorView` in `$effect`, `Compartment` for reconfiguration, `destroy()` in cleanup. `EditorView` and `EditorState` never lie in `$state`.
- **`Diff.svelte`** — a document from lines as the server sent them: line views are decorations, both sides' numbers and the holder mark are gutters, hidden ranges are "N lines" widgets with `onExpand(at, lines)`, inline `spans` are mark decorations. Deleted lines are cut from copying by `clipboardOutputFilter`. `@codemirror/merge` is not needed: the server computes the diff.
- **Highlighting** — a `ViewPlugin` over the [[413c99cc]] session: old tokens map through edits (no flashing), decorations build only for the viewport.
- **Gutters:** numbers; quick-diff strips (added / changed / deleted) with holder color and label; a shared line marker for future graph notes.
- **Overview ruler** at the scroll: diff, search-match, conflict, and cursor marks, viewport frame, click and drag; positions through `lineBlockAt` with `BigScaler`.
- Find and replace in file (`@codemirror/search`), keymap, indent detection, comment Cmd+/ from the [[413c99cc]] language table, theme from the standard CSS variables (55b5437b).

**Does not own:** server protocol, autosave, conflict as product state, tabs, mark meanings (thread, operator, shades) — that is the app.

## Laws written with the delivery

- #rule on `packages/code-editor`: "An outside document change lands outside undo history" — otherwise the operator's Cmd+Z rolls an agent's edit back under the operator's name.

## Card (`set_module`)

- id `@runlith/code-editor`, kind kit, dir `packages/code-editor`.
- entries: `src/document.ts` (`TextDocument`), `src/Editor.svelte`, `src/Diff.svelte`, `src/marks.ts` (gutter and ruler marks, diff lines).
- imports: `@runlith/highlight`, `@runlith/files` (only `lines.ts`); imports-tests: acc2829b.
- order: `marks`, `document` → `extensions/` → `Editor.svelte`, `Diff.svelte`.
- Only the Tagma app imports it.
- Root `package.json`: raise the `@codemirror/view` override (stands at 6.43.0). The past `archive/runlith/app/src/views/file/` integration is taken by copy only (0eee02db).

## Acceptance

Executor:
- `rebase`: non-intersecting edits apply, cursor in place; intersecting ones give `conflict` with ranges;
- `pending()` after a rebase, laid over the new base with `applyLineEdits`, equals the buffer text;
- copying a diff selection holds no deleted lines;
- budgets measured in a headless browser on a fixture (sample with the named machine, fe83acfa): a 30,000-line file — first frame after text arrival ≤ 100 ms, painted viewport ≤ 300 ms; typing in a 100,000-line file — frame p99 ≤ 16 ms, no main-thread work growing with the document; an outside 10-line delta to a 100,000-line file — ≤ 5 ms.

Stand — the kit page on the dev stand with a 100,000-line fixture and an outside-delta stream.
