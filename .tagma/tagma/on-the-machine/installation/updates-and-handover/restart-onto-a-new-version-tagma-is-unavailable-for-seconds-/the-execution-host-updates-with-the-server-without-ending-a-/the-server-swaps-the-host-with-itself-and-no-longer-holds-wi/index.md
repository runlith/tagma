---
id: 01a1271e-2479-7971-9b0c-4ecd2e350fc3
title: The server swaps the host with itself and no longer holds wire compatibility
ord: 8
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
  - kind: waits-on
    to: 01a1271e-2479-7971-9b0c-4ecc9d2e407b
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/host/offer.ts
  - kind: file
    ref: apps/tagma/server/src/executions/host/preflight.ts
  - kind: file
    ref: apps/tagma/server/src/executions/host/replacement.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/succession.ts
---
Starts once [[9ae1db7b]] is in main: the line worktree first updates from main. At stage 1 the successor places `bundle.next` atomically as a candidate and removes it on refusal; the predecessor asks the host to prepare the swap. At stage 2 the predecessor's last act over the host is the handover. The successor takes the host by its own bundle's digest; with a matching digest and load entry the host is not touched (`installation/process/succession.ts`, `executions/host/offer.ts`, `executions/assembly.ts`, `composition/runtime.ts`). Wire-compatibility checks, the bundle manifest's `formats`, and `compatibility()` (`protocol/artifact.ts`) with their printing (`executions/host/recovery.ts`, `executions/cli/host/text.ts`) are removed — until now `buildArtifact` wrote the old number into `formats.record`, unrelated to the record form — along with `when-idle`/`force` modes, `watchReplacement`, `replace_host` and `tagma terminal replace-host`, `HOST_REPLACE_ONCE`, preflight cutover. Proven by the restart stand [[212d752c]] on one's own instance: a restart with a changed host bundle on live terminals keeps pid and record; a held process speaking ndjson over a real link (`external-harnesses/protocol/link.ts`) gets a frame larger than one chunk, taken by the host before the restart, whole and once, and the server consumer reads output on from the old record cursor with no gap and no lost bytes; with a matching bundle the host does not hand over.
