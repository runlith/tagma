---
id: 01a117dd-98e5-7df2-86cb-e3f30d632257
title: "Code engine for the Tagma app: CodeMirror 6, Monaco, and @pierre/diffs (measured 2026-09-26)"
ord: 2
tags: ["research"]
fields:
  {
    "source": {
      "name": "@codemirror/view 6.43.13, @codemirror/merge 6.12.2, monaco-editor 0.57.0, @pierre/diffs 1.5.1 — sources and measurements",
      "ref": "https://codemirror.net, .external/vscode, .external/orca, https://diffs.com"
    }
  }
---
Which to draw and edit code with in the Tagma app (Svelte 5 in an Electron window): CodeMirror 6, Monaco, or `@pierre/diffs`. Measurements are one run on an M2 Max 32 GB in headless Chrome (151 for CodeMirror, 153 for pierre) via puppeteer-core; this is a sample, not proof for other machines. Labs at `/var/folders/87/cmcr9wbs5yqcbthnzgqp7lh80000gn/T/cm-research` and `…/pierre-research` are not kept; the measurement cannot be repeated from this text.

## CodeMirror 6 (`@codemirror/view` 6.43.13, `merge` 6.12.2)

**Source observations.**
- Only viewport ±1000 px in the DOM (`viewstate.ts` `VP.Margin`); unseen line heights are a `HeightMap` B-tree with estimation; a line longer than 4000 characters renders with the middle cut out; a document taller than 7M px uses `BigScaler`.
- Foreign highlighting is a `ViewPlugin` building a `DecorationSet` only for `visibleRanges`; a `RangeSet` maps through edits.
- `@codemirror/merge` `unifiedMergeView` requires both full texts and computes the diff itself (Myers, `scanLimit`); it takes no ready chunks via public API, only `diffConfig.override(a, b) => Change[]`. Deleted lines are non-editable block widgets. `collapseUnchanged` folds the unchanged.
- No overview ruler in the core or `@codemirror/*` packages. `@replit/codemirror-minimap` 0.5.2 is a canvas minimap, not a VS Code ruler.
- `EditorState.readOnly.of(true)` leaves `contenteditable` and gives Cmd+A + copying the whole document from state (`input.ts` `copiedRange`); `EditorView.editable.of(false)` breaks selection.
- There is `clipboardOutputFilter` — it cuts deleted lines from diff copying.
- An outside change is one `view.dispatch({changes})` transaction; selection and cursors map on their own.
- Basic ARIA (`role=textbox`, `aria-multiline`); no screen-reader mode or sticky scroll.
- Author Marijn Haverbeke, MIT, `@codemirror/view` has 258 releases, about every two weeks; 6.x additively stable since 2022.

**Measurements.**
- 30,000 lines / 2.16 MB, read-only, line numbers: `EditorState` 6.2 ms, mount + paint 41 ms, 152 DOM nodes. 100,000 lines / 7.2 MB: 8.5 ms and 15 ms, same DOM.
- Smooth scroll of 120 frames: worst 18.2 ms, p95 17.7, median 16.6, none over 32 ms.
- A 200 KB line: mount 28 ms, 12 nodes.
- 240,000 mark decorations (30,000 lines × 8 tokens): 15–24 ms build in Bun.
- Bundle esbuild `--minify`, min/gzip: view (view, state, gutters, search, wrap) 271/88 KB; with edit, history, keymap, merge, and JS language 448/151 KB; history + `defaultKeymap` add 68/22 KB.

**Not measured:** inside the Electron window, on weak hardware, with real shiki tokens (only synthetic), RTL.

## Monaco (`monaco-editor` 0.57.0)

- Minimal `editor.api` without CSS and workers: 2.72 MB / 704 KB gzip.
- It switches off tokenization, wrapping, and folding for files over 20 MB or 300,000 lines (`.external/vscode/src/vs/editor/common/model/textModel.ts:189-190`).
- Stronger than CodeMirror: built-in overview ruler, minimap, sticky scroll, mature side-by-side diff, screen-reader mode, 84 Monarch grammars.
- Orca (`.external/orca`) patches around it the prototype of an internal `Delayer`, swallows exceptions on diff-editor dispose, and syncs text the `@monaco-editor/react` wrapper drops.
- Replit, Sourcegraph, Livebook left Monaco for CodeMirror 6; Grafana started a migration project; their reasons are bundle size, setup and theming difficulty, global state, weak docs (their blogs, 2022–2024).

## `@pierre/diffs` 1.5.1 (Apache-2.0, Pierre Computer Co)

- Vanilla `File`/`FileDiff` classes and virtualized variants, open shadow DOM, its own worker pool with shiki, `./edit` a built-in editor.
- No column for our own data: annotations are blocks between lines, the gutter a hover slot.
- Inline diff is recomputed by the worker; ready `spans` are not taken (issue #884). Unexpanding the unchanged reads from full texts only.
- No search, keyboard navigation, or ARIA in read mode; a virtual re-render resets native selection. opencode (Solid, 1.2.10) wrapped it with ~1230 lines of its own selection and search.
- Measurement (pool of 2, github-dark-default): a 30,000-line file — `render()` 9.7 ms, highlighting in the worker 2.7 s; a 30,000-line diff with 500 hunks — 111 ms parse on the main thread, 5.5 s highlighting; an 11,800-character line is not painted (1000 limit).
- Bundle: 619/172 KB + worker 838/303 KB.

## Conclusion

For a file and a diff with an authorship column, hidden-section expansion by server request, and editing, CodeMirror 6 fits: it takes foreign highlighting as decorations, maps outside edits as a transaction, and is six times smaller than Monaco. Ours to write: the overview ruler, holder gutters and both-sides numbers, server-diff rendering (no `@codemirror/merge`), a wrapper for Svelte 5. `@pierre/diffs` is out over the authorship column and server `spans`.
