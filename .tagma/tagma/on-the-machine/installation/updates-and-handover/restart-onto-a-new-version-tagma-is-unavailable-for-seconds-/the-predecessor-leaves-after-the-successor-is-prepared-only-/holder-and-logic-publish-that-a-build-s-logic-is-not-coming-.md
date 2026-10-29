---
id: 01a1419a-dac8-7d2a-ab40-006a008fb769
title: Holder and logic publish that a build's logic is not coming up and that a rejected bundle is not taken again, so start and restart waits end on fact
ord: 5
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a14170-c91d-7944-9ec2-0afeb2a15989
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/host/arrival.ts
  - kind: file
    ref: packages/execution-host/native/holder/src/holder.rs
---
After b2a15989, server waits on the execution host end only on fact ([[ce39be5f]], [[11b2a755]]). Three outcomes the holder and the logic know but do not publish, so the successor waits forever, and on handover before the witness is recorded — so does the predecessor:

- **Logic falls before ready while the holder table is not empty.** The holder keeps raising it with pauses up to 8 s forever (`native/holder/src/holder.rs` `children`, `pause`). After activation by exec there is no way back (`returning` is empty, `bundle.next` already moved), so the pause never ends either. The logic, which failed at load (`BootRefused` in `packages/execution-host/src/host.ts`, `main.ts`), writes that refusal nowhere.
- **A rejected bundle is taken again on PREPARE.** A holder that returned with `--returned` or rolled back after a failed exec remembers the bundle in `rejected`, but PREPARE refuses only `abandoned` (`holder.rs` `Request::Prepare`). Every handover request (a new witness of the same logic) prepares and activates that bundle again, and the cycle never ends. The recorded decision [[a12fc10c]] ("does not take without permission") allows this; changing it is the operator's decision.
- **The refusal file does not name the candidate.** `yieldRefusalPath` is a bare string; a refusal recorded for a previous candidate or via `channelLost` is taken by the successor as the answer to its own request, and it drops the candidate. Its writer is the logic of another build, so only the build that writes it will read the new file form.

To do: the holder or the logic publishes the fact "logic of digest D is not coming up" (a failure record next to the load entry or in the registry) and refuses PREPARE for a rejected bundle or explicitly records why not; `awaitLogic` and `departed` (`apps/tagma/server/src/executions/host/arrival.ts`, `departure.ts`) end their waits on these facts.

Done when tests over the real functions show: logic that falls before ready with a non-empty table ends the successor's wait with a verdict carrying its cause; a repeated handover request for a rejected bundle answers with refusal, not a new activation.
