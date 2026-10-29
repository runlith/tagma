---
id: 01a1661b-11df-79d0-87fa-5228cbb0f9bb
title: submit_work landing splits HEAD and working-file texts into lines on the server event loop
ord: 59
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16604-27ae-790e-9bdf-5666d6c06b6f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16603-f35a-79c5-af42-75212ddea043
  - kind: relates
    to: 01a10292-123c-7598-b815-bdae7a910861
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/selection.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/tree.ts
---
For every line-sliced path, the `submit_work` landing parses whole texts on the server event loop. `prepared/tree.ts` (around line 531) builds `contentOf(was)` and `contentOf(bytes)`: digest, `tokensOf`, `bufferOf`/`shareText` of the HEAD and working-file texts. Then `selectFold` (`lines/selection.ts`) calls `tokensOf(base)` again and assembles the whole selected text. Cost grows with file size and landed-path count, which violates [[7a910861]].

Found while working on [[2ddea043]]: the Holdings verdict there already prepares texts in `Walks` (`walks.content` / `walks.file`). Landing never took that road.

**Do.** Drop the parse in landing that repeats the verdict already made: digests are checked against `judged.digests`, and the verdict's Content is not rebuilt. Hand the heavy remainder — parsing and assembling the selected text in `selectFold` — to the owner's worker (`Walks`).

**Proof.** Landing a large file with others' lines beside yields the same commit and the same `carried`. The loop gap on landing stays under ~50 ms.

**Done (`f0575d27e5`).**
- Landing reads the working file as bytes. Both sides of the path — HEAD and working file — are prepared by `Walks.file` in the worker: decoding, digest and line offsets. `PreparedFns` now carries `walks`. Digest comparison against `judged.digests` and `selectFold` stay on the loop.
- `selectFold` cuts unchanged base spans by HEAD line offsets and no longer calls `tokensOf`. Its work scales with the verdict's changed lines.
- Under an open merge the worker overlay decodes base and index, not the loop.

`selectFold` did not move to the worker. The verdict already sits on the loop, a fold builds it, and the move would need a structured clone as large as the selection work itself.

**Measurement.** The loop span in `planPath` measured on one fold: a 45,000-line file (3.9 MB, near the `WEIGHED_BYTES` limit), own edit and a neighbor's edit. One machine sample, 4 runs:
- before: 22–172 ms per path;
- after: 2–8 ms, of it 2–6 ms copying bytes to the worker;
- on a 10,000-line file: before 5–8 ms, after 0.5–1.3 ms.

Selected text and lines match byte for byte. Landing, merge and change-record tests are green.
