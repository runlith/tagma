---
id: 01a11b83-9e82-77b2-8bc2-9d5578efcd89
title: A file or directory link confirms by reading, and a file outside checkouts opens and edits in the same editor, past the change record
ord: 8
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/PathRoads.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/MarkdownBody.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/opening/PathChecks.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/opening/PathLinks.ts
  - kind: file
    ref: apps/tagma/server/src/checkout-files/contract/wire/place.ts
  - kind: file
    ref: apps/tagma/server/src/checkout-files/documents/folders.ts
  - kind: file
    ref: apps/tagma/server/src/checkout-files/entry.ts
  - kind: file
    ref: apps/tagma/server/src/composition/http/checkouts.ts
  - kind: symbol
    ref: apps/tagma/server/src/checkout-files/tree/target.ts
    symbol: Targets
---
The operator opens any readable regular file and any readable directory on the server, regardless of checkout and project; absence and closed permissions yield no link. `place_path` answers what stands at the path — a file or a directory (`entry.kind`) — and the checkout holding it (`place`), with one path open and `stat`; on an OS where a directory does not open as a file (`EISDIR`), a separate `stat` recognizes the directory. One road builds the link from this answer — `PathRoads` (`features/checkout`): a file is a `fileLink`, a directory a `directoryLink`. A directory's full place outside every checkout is the machine's file manager, which exists only at the local door (`Outside.local`, the same condition as the Finder item): through a remote door such a path stays text. Plain message text, including between agents, and Markdown share one path recognition and one confirm-and-open loop. In Markdown the check starts once streaming and the final-text render complete: a mid-stream inline code span is not yet a path. Confirmation is one everywhere — `PathChecks` (`features/opening`): repeated paths share one read, the answer lives within the mounted message, editor, or terminal (at most 1024 paths, the oldest leaves first), requests cancel on leave, and a refusal is not an answer — the next check asks again; a click re-reads whether the file or directory exists. A confirmed path becomes the opening rule's link (`linkTarget` of the `Opening` owner), not its own click handler. In the block-body editor a path is only inline code: the same read confirms it, the editor marks confirmed code with a decoration (`codeLinks` in `@runlith/markdown-editor`), because attributes do not stick to ProseMirror nodes from outside, and one delegated handler on the editor root catches clicks and the menu. Code being written is not checked until the caret leaves it (or the editor loses focus), and an edit recounts only the nodes it touched: otherwise every typed character would be a new path and a new `place_path` request. A check refusal in the editor goes to the error list.

- A checkout file of any registered machine project opens as a checkout document and is written through `write_document` and intake under that checkout's project. Everything else — a file outside every checkout, `.git/`, the graph tree — is a disk document: `file.subscribe` by absolute path and `write_file`. Nothing forbids writing; only the system itself can refuse (permissions, not text, too big).
- A disk document lives in the same `OpenDocuments` cell as a checkout document: the same `whole`/`change`, echo by record id, `moved` on a stale base. Differences: the file's directory keeps its own non-recursive watcher (`FolderWatches`), polling where no watcher is available; the record has no change record and no git, so no lines ever belong to anyone, and a missing file is always `gone`, never `moved {path}`.
- `Targets.placed` looks for the checkout first among the calling project's checkouts, then machine-wide, so `Targets.loose` refuses `in-checkout` for any project's checkout file: a checkout write never bypasses intake; `.git/` and the checkout's graph tree do not count as checkouts — `place_path` (place = null) carries them the same way.
- The HTTP door `/api/files/preview` remains, for the operator only, the source of picture and PDF bytes outside checkouts (`full=true`) and of video by byte ranges (a page recording in the feed), text as text/plain under a sandbox CSP; with `save=<name>` it hands the whole file over as a download under that name — how a person picks up browser-page downloads from the panel and from the phone. A feed picture opens in the chat lightbox, a PDF in a browser tab.
