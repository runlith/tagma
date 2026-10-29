---
id: 01a14c13-c481-7acc-8aa6-03c767192d2e
title: A path from chat or terminal opens in its own checkout of any project, a directory in Files, and a file outside projects in the same editor
ord: 9
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/files/FileOpener.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/opening/pathCode.ts
  - kind: symbol
    ref: apps/tagma/server/src/checkout-files/contract/wire/place.ts
    symbol: PLACE_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/checkout-files/contract/wire/writes.ts
    symbol: WRITE_OPERATIONS
---
**Value.** The operator clicks a path in an agent answer or command output and lands in the file on the right line, in whatever checkout and project it lies.

**How.** Path links in the feed, terminal, block body, and the block page's Sources rows; the `place_path` operation; files outside checkouts — the `file.subscribe` subscription and `write_file` saving.

**Behaviour.**
- A path is absolute or from the thread root; the server finds the checkout owning the file — first its own project, then any on the machine.
- A click opens the file beside — as a right-area tab of whoever is on screen: thread, draft, or section without a thread; the same file with another line moves its tab to the new line. ⌘-click (Ctrl off macOS) and "Open in Files" in the tab header open it in Files on the same line. Another project's checkout file in Files opens on that project's Checkout page, in a tab named for the branch.
- A file outside all checkouts, in `.git`, or in the graph store opens and edits in the same editor, with the same autosave and conflicts, but without line accounting or git. An image from the feed opens in a lightbox, a PDF in a browser tab.
- A plain path without Markdown markup is recognized in answers and in the operator's or inter-agent messages alike. An absolute path, a path with a directory, and `file://` may carry `:line:column`; trailing sentence punctuation isn't part of the path. Inline code and Markdown links allow a path with spaces. An angle placeholder taking a path component or its pre-extension name is kept as part of the path and doesn't turn on HTML formatting in Markdown. URL parts, including query and fragment, don't become file links.
- An existing readable file or directory becomes a link. A directory opens by click and ⌘-click in the Checkout page's Files where it lies; a directory outside all checkouts — in the machine's file manager. A file opens beside by click and Enter, in Files by ⌘-click and ⌘Enter; right-click opens the link menu: both places, external editors, Reveal in Finder, copying the path — the same for plain text, Markdown, and block body. A file in a feed commit card opens its diff in the thread's Changes by click, the commit in Git by ⌘-click.

**Limits.** A directory outside all checkouts becomes a link only for a window opened on the server machine: through a remote door, e.g. from a phone, that machine has no file manager, and the path stays text. A checkout of another project missing among its branches (a detached worktree, an adopted root) isn't addressed by the page, and opening answers with a notification. A checkout file isn't written by `write_file`: writing into a checkout past accounting is impossible.
