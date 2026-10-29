---
id: 01a117dd-98e5-7df2-86cb-e3f89c88344d
title: "checkout-files module: directory listing, path index for Cmd+P, content search, and live document; one watcher per checkout"
ord: 7
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/watch/tree.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/rows.ts
---
The server serves the operator a checkout's files for reading: directory listing, path index for Cmd+P, content search, and a live document that updates itself when an agent edits the file. A new `checkout-files` module and one watcher per checkout.

## What stands now

- The surface has none of these operations: listing, reading any file, searching by name and content exist only in agent tools (`packages/agent-tools`).
- The checkout watcher opens and holds `CheckoutRows` (`apps/tagma/server/src/workspace/checkouts/rows.ts` `observe`, `drop`) and reports outward only `onMark(rootId)` without paths. `platform/watch/tree.ts` is the mechanism: every call opens its own `fs.watch`.
- `packages/git/src/entries.ts` already knows `filesUnder` (`ls-files --cached --others --exclude-standard`) and `ignoredAmong` (`check-ignore --stdin -z`).

## `CheckoutWatch` (workspace)

- One watcher per checkout: `follow(rootId)` → a `TreeShift` stream (paths with event kind: `rename` — directory content changed, `change` — bytes; or `rescan` with a reason), refcount, close after the last subscriber with the same `LINGER`.
- Subscribers: `CheckoutRows` (instead of its own `observe`), `checkout-files`, the Holdings judge — if it ever needs paths.
- A slow subscriber gets a collapsed path set since the last delivery, not a queue; a set past the limit is one `rescan {overflow}`. The limit is derived from the machine budget (fe83acfa).
- `platform/watch` stays the mechanism: ownership moves out of `CheckoutRows`, there is no second owner.

## `checkout-files` — read operations

All `callers: 'operator'`: agents have their own tools. Each works in the checkout chosen by `projectId` and `root?` (canonical by default).

- **`read_directory {path, limit?, cursor?}`** → `entries [{name, kind: file | directory | link, ignored}]`, `total`, `next` (68659e3b: the page ceiling is derived from the measured row, default 500). `readdir` + `lstat` + one `ignoredAmong` per page; a directory the client already knows as ignored (`ignored: true`) is answered without git — all its entries are ignored. Order is directories then case-insensitive names, numbers by value; the server sets it because it cuts pages. `.git`, `.DS_Store`, and the `.tagma` graph storage are hidden. A symlink to a directory is disclosed only inside the checkout (`CheckoutPaths.pathWithin`), otherwise shown but not disclosed.
- **`tree.subscribe`** — frames `{dirs}` with directories whose content changed, or `{rescan}`; the client rereads only disclosed and visible ones. Byte events do not touch the tree: decorations arrive with the checkout row and Holdings.
- **`find_files {query, limit?, recent?}`** — the checkout path index in a worker (7a910861): tracked and untracked-not-ignored, as `filesUnder`. Scorer is VS Code `fuzzyScorer` criteria: name above path, adjacency, word starts; several words are all required; `recent` gets a bonus. Answer is up to `limit` (50, ceiling 200) paths with matched-character positions. The index builds on first request, lives while asked plus a delay; a path batch with `rename` → one `filesUnder` over them; any `.gitignore`, `info/exclude`, or `core.excludesFile` change rebuilds.
- **`search.subscribe {pattern, regex, caseSensitive, wholeWord, include?, exclude?}`** — ripgrep [[bcb8266a]] with `--json --hidden`, without `.git` and `.tagma`, `--max-columns 500 --max-columns-preview`, `--max-filesize` = 16 MiB. Frames per file `{file, matches [{line, preview, ranges}]}` and a total `{files, matches, truncated, elapsed}`; limit 20,000 matches, like VS Code `search.maxResults`. Unsubscribe kills the process.
- **`document.subscribe {path}`** — a live document:
  - frames: `whole {digest, text, readOnly: null | 'undecodable', size}` — first and after eviction; `change {digest, edits: LineEdit[], write?}` — a row delta from the previous frame; `binary {size}`, `tooLarge {size}`, `gone`, `moved {path}`, `unreadable {reason}` — a read failure never becomes empty text (ea465bed);
  - client text is LF rows without BOM; separators and BOM stay in bytes on the server;
  - one cell per `(checkout, path)` for all subscribers holds the previous text and digest. A path event → stat key `@runlith/files/working`; moved — read, `contentOf`, digest; otherwise a row diff (`packages/utils` sequenceDiff with a deadline, large text in a worker; on deadline one edit over the whole range);
  - held text total is bounded by a machine-memory share; past it cells LRU-release text, and their next frame is `whole`. A subscriber with piling undelivered frames has its queue replaced with one `whole`;
  - `moved` and the `write` field in `change` arrive with the operator entry [[588b85a5]]: before it the cell has neither its own entries nor a read of the rename fact, and a missing path answers `gone`.

Reads run in the server process, not in a thread command window, so they cannot take someone else's shift ([[b17adfeb]]).

## Manifest and cards

- Manifest `checkout-files/checkout-files.ts` (edea5454): `operations` — `read_directory`, `find_files` (and the write operations [[588b85a5]]); `live` — `tree.subscribe`, `search.subscribe`, `document.subscribe`; `lifetimes` — index and cells. The HTTP door, live channel, and call take them from the manifest.
- Card `checkout-files`: kind product, dir `apps/tagma/server/src/checkout-files`; entries `.` (for composition 13182a9f) and `contract/wire/` (product wire); imports — 06405a5f workspace, 00ddf0e5 change-record, edf810fe, b77b7a93, adeeb4b, 90d97bc9, 457e7a6c, 382fa6aa, 2a74de70; order `contract/wire/` → `contract/service/` → `.`. Body: "The operator works with a checkout's files like in an IDE: listing, path index, search, live document and edits on their behalf. Entry rows and their ownership are change-record, the checkout git state is workspace, editor and tabs are the app."
- 06405a5f workspace: entry `contract/service/watch.ts`. 13182a9f composition: imports + `checkout-files`.

The module stands apart from workspace because the operator's write must go through the change-record intake, and workspace is below change-record; and apart from change-record because it owns entry rows, not tree, search, and documents.

## Deleted

`observe` and `watch` in `RootState` `workspace/checkouts/rows.ts` — replaced by `CheckoutWatch`. The edit touches source [[fe04fc30]].

## Acceptance

- An event on one of 1,000 paths with open documents reads one path — by cell spans.
- Creating a file in a directory gives a tree frame with one directory.
- The index updates in a batch without a full rebuild — by git process count.
- Unsubscribing from search kills ripgrep.
- A document read failure is an `unreadable` frame, not empty text.
