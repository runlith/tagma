---
id: 01a117dd-98e5-7df2-86cb-e3fbb51edd1b
title: "Checkout surface is the code workplace: Files | Search | Git column, tab area, Cmd+P, and opening paths from chat and terminal"
ord: 9
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/CheckoutPage.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Pane.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/palette/Palette.svelte.ts
---
The Checkout surface becomes the code workplace: tree, search, and Git in the left column, one tab area on the right, Cmd+P, pictures, markdown preview, and opening paths from chat and terminal. This spec delivers all of it in read mode; edits and file operations come with [[588b85a5]].

## Place

- `apps/tagma/app/src/lib/features/checkout/CheckoutPage.svelte` (793 lines, debt 6b3210c7) is taken apart by subjects: a left column with a **Files** (default) | **Search** | **Git** switch, where Git is the current `<aside data-checkout-list>` contents (changes, commit box, history), and an `EditorArea` instead of `<main>` with `DiffPane`.
- The worktree board (`GitTab.svelte`) stays the top view with several worktrees and no selected branch. Past 900 px (`DRILL_BELOW`) column and editor are two screens, as list and diff are now.
- Checkout is a `GraphAim` (`?branch=`), like the Git tab and status bar (`features/checkout/Selection.svelte.ts`).

## Tree

- Lazy directories via paged `read_directory`, a "N more" line under an overfull directory; `tree.subscribe` frames re-read only expanded visible directories. While an inline input is open or a drag runs, frames accumulate and apply after.
- Ignored are dimmed (as by default in VS Code; `node_modules` is not hidden hard). The git letter and name color come from the checkout line; holder dots in `handHues` shades and "You" come from Holdings, the tooltip naming threads and their `+/−`. A directory with changes inside gets the color and dot; deletion does not spread onto a directory; this is a client-side projection of the line's paths by prefix, not a second fact output.
- The active file is revealed in the tree; typing letters with tree focus jumps to a matching visible line.

## Tabs (`Tabs`, graph tier)

- The tree, search, and tab code lives in `features/checkout/files`, and `FileOpener` with path parsing in the low `features/opening` zone: tree, tabs, and the Git view call each other, and a separate feature would make a zone cycle.
- Preview tab (italic): a single tree click and a search result open it in place of the previous one; an edit, double click, tab drag, or Cmd+S pins it. Cmd+P, a terminal or chat link, and a created file open pinned at once, as both do.
- Pinned on the left; "Close others / right / all" do not close them; Cmd+W, middle click; Cmd+Shift+T restores a closed one (stack of 20).
- Tabs live on the `GraphAim` in `PlatformStorage` (`@runlith/layer/Platform`): `rootId`, path, view, preview/pinned, active, selection and scroll; contents are not stored — autosave keeps the disk fresh. No tab-count limit.
- Tab views: file (`FileTab` — the `Editor.svelte` kit [[1759d27d]] over `document.subscribe`, read-only in this spec), diff (`DiffTab` from [[db56abc2]] with an "Open file at this line" button), picture (`ImageTab` through the existing `/api/checkouts/:rootId/picture` door: png, jpeg, gif, webp, avif, bmp, ico; SVG as text, preview as picture), markdown preview (`PreviewTab`, `@runlith/markdown` over the live document, Cmd+Shift+V).
- Stubs: a binary file shows its size; over 16 MiB — size and path with "Copy path"; non-UTF-8 — read-only with a mark. "Open in system" needs a new desktop IPC, and the window opens exactly one fact outward ([[8e099157]]) — the operator decides.

## Cmd+P and search

- Cmd+P opens the shared palette (`features/palette`) in **files** group mode — one widget, as Quick Open and Command Palette are in VS Code. In "all" mode files are their own group of three lines. An empty query shows recent files of this `GraphAim`; a `:42` or `:42:7` tail opens at the line; matched characters are highlighted. Every letter asks `find_files` without debounce; the previous one is cancelled (2393aff1).
- The **Search** view (Cmd+Shift+F, `FileSearch`): regex, case, word, include/exclude globs; results stream in per file from `search.subscribe` and collapse; a click opens a preview tab at the line with the match highlighted; a counter and a "showing N of M+, narrow down" note at the limit. A new query cancels the previous one.

## Opening paths (`FileOpener`, app tier)

- One "where to open" decision: in chat — the active thread's stage (`OpenFile.svelte.ts` with the `file` view and a line), on other surfaces — a Checkout tab. Triggers only call it.
- Terminal: `path:line:col` links are already parsed (`features/executions/terminal/links.ts`); the "Tagma has no file view yet" stub (`Pane.svelte.ts`) is replaced with a `FileOpener` call.
- Chat: tool-line paths become links through the kit's product port `onOpenPath` (`@runlith/chat-ui`); `path:line` in message inline code becomes the product inline form in `@runlith/markdown`.
- A path from chat or terminal (absolute or from the thread root) is resolved by the server `place_path` operation of the `checkout-files` module (`CheckoutPaths.placeOf`) into `(checkout, path)`; another checkout's file opens in its own, the tab marked with the branch, the tree not switched.

## Keyboard

Cmd+P — file; Cmd+Shift+F — search; Cmd+Shift+E — tree; Cmd+Shift+G — Git; Cmd+W / Cmd+Shift+T — tabs; Ctrl+Tab, Cmd+Shift+] / [, Ctrl+1…9 — tabs; Cmd+F / Cmd+Alt+F — find / replace in file; Ctrl+G — line; Cmd+D, Alt-click — multicursor; Cmd+/; Alt+Z — wrap. In the tree — arrows, space opens, Cmd+↓ opens pinned, typing letters. Cmd+K stays the palette, Cmd+\ the column (`app/chrome/Shell.svelte`). In the desktop Cmd+W and Cmd+Shift+T are routed by the app, not the Electron window (menu in `apps/tagma/desktop`).

## Removed

The `Pane.svelte.ts` "Tagma has no file view yet" stub; the 650-line debt in `CheckoutPage.svelte` leaves through the teardown.

## Acceptance

- Executor — svelte tests of model contracts: `Tabs` restores the set and the active one, preview is replaced, `FileOpener` picks the place, the palette in files mode asks `find_files` and opens at the line.
- Operator — by hand on the dev stand: tree with decorations, tabs after reload, Cmd+P with `:line`, search, picture, markdown preview, a link from the terminal and from chat.
