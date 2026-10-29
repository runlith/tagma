---
id: 01a12a49-4b32-7524-9d42-73d1f24dba09
title: Update the host line branch from main and check the resolved tree
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
---
Main merged into the host line branch: 07393b3532b828007f0c802e601332fdf122eeca. Parents — b18315ed7a5508b8d8b8f2997a6b06d814b88612 and main abe78e1a02c10be84beae8fbdc36b1d035be8f54; merge-base before the act — 2e92f0a6dc38e36d32a581253d1ae96dbf59aec4.

Git ort finished the merge automatically: no conflicts, no manual resolutions, no skipped hooks. All 17 code files main changed after the merge-base are byte-equal to main in the merge; their edits are not lost. .tagma not touched by hand. Uncommitted buildArtifact.ts, terminals/targets.ts, and parallel-stand files not touched; departureGate.itest.ts changed under another author during the checks.

Checked on the shared working tree: build:native -j1 — exit 0 (10 old libc/mach deprecation warnings); execution-host native tsc — 1401 files, exit 0, 3.237 s; executions — 494 files, exit 0, 0.503 s. No manual resolutions of code files, so no tests of resolved files. The full server native tsc checked 5553 files in 15.987 s and exited 2: hostRestart.ts:186/189 — TS2339 launchedFor/execution outside record (3 diagnostics); serverHost.stest.ts:17 — TS2345 callback map passes an index instead of ParseOptions; :75 — TS2769 string instead of Digest. Both unfinished files belong to the [[01a12838-ee89-7a11-b735-7fb89e320089|stand author]] per read_changes; the exact errors handed to him, his rows not fixed. Green of the full server check on a finished stand is not yet proven. The parent is notified; the branch itself is updated and holds no code paths of its own.

The reconciliation covers all new main code after the merge-base; a semantic audit of the rest of the automatically merged line changes and full system runs were not done in this subtask. Project main not switched or changed; the working Tagma server untouched.
