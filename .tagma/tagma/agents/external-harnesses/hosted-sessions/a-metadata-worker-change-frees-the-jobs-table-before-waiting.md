---
id: 01a16ee6-c77f-7155-854b-349bb7b07432
title: A metadata-worker change frees the jobs table before waiting for it to finish
ord: 9
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/metadata/harnessMetadata.ts
    symbol: makeSessionMetadata
---
Metadata publishing passes through HarnessSessionStore and calls SessionMetadata.observed again. If observed holds jobsHeld while waiting for the previous worker's interruption, that worker may atomically publish an observation and wait on the same jobsHeld; then one session blocks everyone else's hooks. The interruption request is sent when the job is withdrawn: cancelling observed between the table swap and the wait never leaves the old worker without an exit signal. Its finish is awaited outside the critical section; the finalizer removes the record only while it still belongs to it.
