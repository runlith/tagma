---
id: 01a14bd9-00b7-77e0-99c2-1faee6788c21
title: Bring seven A3 "Knowledge graph" divergences between Tagma promises and code to one behaviour
ord: 68
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14bc8-08dd-7610-b638-1e49b0cec196",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14baa-f3c2-71d8-ba1f-4e8faf7feb31
---
The A3 area oracle found seven places where an operation description, a `#feature` record, or the app surface promises one thing and the code does another; the `#feature` records under [[af7feb31]] name each. Every divergence is confirmed against the code and fixed at the owner of the wrong value, and the `#feature` record is rewritten to current behaviour.

1. `update_block` with `parentId: null` — the server refused with `project-root`, the description promised a move to the root.
2. `revise_amendment` — the description said "as its author", the author is not checked; the text is fixed, no gate is added (rule [[06e41b6f]]).
3. `supersede_block` — the text promised operator approval for "settled truth", there is no check; the text is fixed.
4. `read_owners` returned resting work as owners.
5. The `open-children` gate let the operator through in a direct call but not in `apply_batch`.
6. The spatial map named a nonexistent `area` tag, and `#module` was drawn as a faceless circle.
7. The block page showed reflection facts and the `source` line only for tags with the literal names `reflection` and `research`.

Proof — `bun run typecheck`, integration tests of the touched owners, and commits 11dd08f950, aead73c2ef, dd479528f7, 90344e97cd, c57c13338c, a5bf1a4c60. Points 6 and 7 (the map and the app block page) were verified by svelte-check only: never opened in a browser.
