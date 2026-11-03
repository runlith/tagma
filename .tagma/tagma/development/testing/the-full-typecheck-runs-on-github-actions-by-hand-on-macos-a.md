---
id: 01a19ec3-2099-7b38-82e3-72442c1388d8
title: The full typecheck runs on GitHub Actions by hand, on macOS and Linux
ord: 17
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19eb2-4a56-79d0-9dbd-af67ec98a662",
    "status": "in_work"
  }
sources:
  - kind: file
    ref: .github/workflows/typecheck.yml
---
The operator's decision, 2026-11-03: the earlier `test.yml` workflow and its setup action are removed. CI is rebuilt one check at a time. Each check first runs as a workflow started by hand and is measured on GitHub's own runners before anything triggers it on its own.

The first check is the full typecheck: `runlith-typecheck .` over every workspace package, 74 through tsrs and 10 through svelte-check. It runs on `macos-latest` (3-core M1, 7 GB) and `ubuntu-latest` (4 cores, 16 GB in a public repository), so that one run compares both runners. tsrs ships darwin-arm64 and linux binaries but no darwin-x64, so Intel macOS runners cannot run it.

Local reference, one sample: on Apple M2 Max with load average 7–9 from other agents, 50.3 s wall, about 53 s CPU (user plus sys of the children), 794 MB peak resident memory, green with warnings only. Wall and CPU are close because the packages are checked one after another.

Done when the workflow is on main and one run's per-step times on both runners are recorded here.
