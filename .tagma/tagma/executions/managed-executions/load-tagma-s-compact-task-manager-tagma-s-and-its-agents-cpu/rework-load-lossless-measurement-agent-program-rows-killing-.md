---
id: 01a13616-a718-7223-86c3-78cd69b7211d
title: "Rework Load: lossless measurement, \"agent / program\" rows, killing with an outcome, and a compact panel"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13616-e64d-7243-bac2-4d8b0e28c96e",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a11b5e-918b-7fdb-80da-5009552ae607
---
Implement the [[552ae607|Load rework]] in full: lossless measurement (counters with reaped children, the whole population per pass, `ps` for refused counters on macOS, process facts once per identity), attributing each process to exactly one row — agent or program — killing by verified identity with an outcome, and the new compact panel with status bar. The old shape — `tree.ts`, `sums.ts`, `LoadBands`, `LoadProcesses`, `LoadOrphans`, the panel's project reads, the Managed work / Tagma / Unattributed categories — is deleted in the same change.

Start from `packages/execution-host/native/src/usage.rs`, `packages/execution-host/src/posix/Usage.ts`, `usageRate.ts`, `ProcessUsage.ts`, `ProcessAccount.ts`, `apps/tagma/server/src/executions/load/`, `apps/tagma/app/src/lib/app/chrome/Load*.svelte` and `apps/tagma/app/src/lib/features/executions/load/`.

Done when the spec's "Proof" is fulfilled, the work is landed, and the notes it refutes (e.g. "Machine-vs-process CPU difference doesn't establish load provenance") are fixed.

## Outcome

Landed in `6c2a722c80`, `8e0e9257a3`, `d4d7825f78`, `d9d4b692c4`, `4d549b2d56`. The [[4f7c55d5|per-row CPU accounting]] note is rewritten for the new accounting, [[b8b6ac56|identity stop]] for generic ending of any listed processes.

Verified: host, server and app typecheck for changed owners; accounting unit tests (child reap, several generations leaving in one interval, a holder-reaped command, and a late report of it), Load list, operations, wire corpus; serving, loadUnavailable, bundleBoot, hostArtifacts itests; usage cargo tests (macOS); `MachineLoad.stest` — 0.99-core work, 0 of ~650 processes unread, 17–22 ms pass main-thread CPU. Scenario on its own `tagma:try`: a stream of 0.5 s loaders — a 1.98-core row against a 1.97 truth (shell `times`), rows vs machine at worst 1.8% of the machine; no ≥100 ms host stall during the scenario. Review — the main one and three lenses, confirmed findings fixed.

Unproven: Linux and Windows (Linux grouping by its own exe, Linux birth in ticks not compared against wall-clock; Windows with no child reap); a descendant's provenance after leaving the tree between passes isn't kept by Load itself; the pre-signal identity check isn't atomic with the signal (macOS with no pidfd); past the wire budget a heavy group loses processes and the button; app tests after the last `View`/`LoadPanel` fixes weren't run — vite config was broken by a parallel port edit.
