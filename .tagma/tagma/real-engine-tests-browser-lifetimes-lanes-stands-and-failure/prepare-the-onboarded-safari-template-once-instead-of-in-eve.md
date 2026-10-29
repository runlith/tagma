---
id: 01a184f3-78e3-7328-bb88-2f288344c387
title: Prepare the onboarded Safari template once instead of in every native run
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18358-6882-7146-96af-279f8f0fbb3e",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18497-aa6f-727a-8975-5629115e28fc
sources:
  - kind: file
    ref: packages/e2e/src/lanes/simulator.ts
  - kind: file
    ref: packages/e2e/src/lanes/template.ts
---
Every native e2e run creates, first-boots (CoreSimulator data migration) and onboards a fresh MobileSafari template inside its beforeAll hook. That took 2:08 of the 180 s hang guard in an uncontended green run and crossed it under load: in feed-stand's run.51794 Safari launched 2:38 into the run, and the guard expired during onboarding. Keep the onboarded, shut-down template in a persistent set keyed by runtime, device type and pinned tool versions. Prepare it under a file lock, publish it only once preparation completes, and have each run clone it into its own run-owned set (`simctl clone <device> <name> <destination set>`), so per-run setup is clone plus boot. Per-run sets keep their existing retirement. Verify through packages/e2e/src/lanes/ios.e2e.ts and the stand native caller.