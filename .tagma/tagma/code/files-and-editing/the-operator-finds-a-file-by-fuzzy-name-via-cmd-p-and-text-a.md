---
id: 01a14c13-c481-7acc-8aa6-03c4281cc328
title: The operator finds a file by fuzzy name via Cmd+P and text across the checkout as Search
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a640beeb16
sources:
  - kind: dir
    ref: apps/tagma/server/src/checkout-files/finding
  - kind: dir
    ref: apps/tagma/server/src/checkout-files/search
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/files/FileSearch.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/palette/Files.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/checkout-files/contract/wire/paths.ts
  - kind: file
    ref: apps/tagma/server/src/checkout-files/contract/wire/search.ts
---
**Value.** File jumps and code search work as fast as in an IDE, even on a large repository.

**How.** Cmd+P opens the palette in files mode (the `find_files` operation); the Search view in the column — Cmd+Shift+F or "Find in folder" from the tree (a live search stream).

**Behaviour.**
- Quick Open searches tracked and untracked files git doesn't ignore: every query word must match, the file name weighs more than the path, matched letters highlighted. A word may skip letters, and in a file name also contain a typo (`icomdark` finds `icon-dark.svg`); such a name ranks above letters scattered over a long path. An empty query is the checkout's recent files; a trailing `:line` tail opens on the line. Every letter is a new query, the former is cancelled.
- The path index builds on the first query, then follows the tree, and is released when long unasked.
- Search is ripgrep with regex, case, whole word, and include and exclude masks; results stream in by files, a click opens the file on the line with highlight. A new query cancels the former.

**Limits.** Search cuts off at the match limit and says so. Both doors are the operator's only; the agent searches with `glob` and `grep`.
