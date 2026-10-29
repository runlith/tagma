---
id: 01a10292-123c-7598-b815-bdae7a910861
title: "The server's event loop never synchronously executes work whose cost grows with data and has no upper bound: its owner executes it in a worker"
ord: 100
tags: ["rule"]
sources:
  - kind: dir
    ref: apps/tagma/server/src
---
The server's event loop never synchronously executes work whose cost grows with data and has no upper bound: its owner executes it in a worker.

That is diffing and line alignment, parsing and serializing large histories, hashing content, walking and sorting whole collections — anything that on the weakest machine Tagma serves can take over ~50 ms in one synchronous pass, the noticeable-response threshold. First the cost is cut down to what the work touches; what stays heavy after that goes to a worker. A computation's owner provides the worker and answers asynchronously; the caller neither slices the work with yields nor hides it behind debounce. Work bounded by construction — one line, one page — stays on the loop.
