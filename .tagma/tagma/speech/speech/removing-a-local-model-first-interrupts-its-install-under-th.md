---
id: 01a11268-d9e2-7b25-94bb-a4f148329f09
title: Removing a local model first interrupts its install under the same lock that starts installs, so the store never sees a mid-write removal
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/speech/models.ts
  - kind: file
    ref: packages/speech-whisper/src/models/ModelStore.ts
---
Different models install concurrently: the store holds a claim per model, not one slot, because each has its own `.partial` directory. Only the same model conflicts — two writes to one file or deleting a file being written.

`Models` does not start a second install of the same model (it answers `installing`), and `remove` interrupts the install fiber and waits for release to drop the claim before wiping files — all under one `Semaphore` that also serializes install start. So `InstallBusy` from `ModelStore.remove` is treated by composition as a defect, not a refusal: its appearance means that order is broken.

When an install is running, the operator gets a question (`install-running`): removal cancels someone else's download. Install-feed subscribers get `progress` with a cancellation reason, then `removed`.
