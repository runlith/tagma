---
id: 01a1ae17-3407-754d-8e1f-e4fba1bd33ce
title: The step-back offer learns which graphs it would leave read-only from graph serving, not by rereading every project on each frame
ord: 52
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a1add2-66f1-7362-b87d-ed3fa8fa0327
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/backGraphs.ts
---
`withBackGraphs` (`composition/backGraphs.ts`) answers `readOnlyGraphs` on every `reading`, `check` and streamed frame by listing every project, reading their policies, resolving each storage layout and reading each graph's format marker, so the cost of `read_machine_state` — polled while an update installs — grows with the registered projects even when nothing changed. A graph's marker moves only when this build advances that graph, or when a project is registered, moved or removed. The projection belongs to its producer: graph serving publishes the step each project's graph stands at as it opens and advances graphs, the project registry its changes, and the offer reads that standing projection. Done when a frame reads no project row or marker file, and a graph advanced while the server runs still appears in the next frame's warning.