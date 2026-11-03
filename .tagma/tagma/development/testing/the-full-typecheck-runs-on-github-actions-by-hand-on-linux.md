---
id: 01a19ec3-2099-7b38-82e3-72442c1388d8
title: The full typecheck runs on GitHub Actions by hand, on Linux
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

The first check is the full typecheck: `runlith-typecheck .` over every workspace package, 74 through tsrs and 10 through svelte-check, on `ubuntu-latest`. tsrs ships darwin-arm64 and linux binaries but no darwin-x64, so Intel macOS runners cannot run it.

## Measurements, one sample each

| Where | install, cold cache | typecheck | whole job |
|---|---|---|---|
| Apple M2 Max, local, load average 7–9 | — | 50.3 s wall, about 53 s CPU, 794 MB peak resident | — |
| `macos-latest`, 3-core M1, 7 GB | 31 s | 59 s | 2 min 13 s |
| `ubuntu-latest`, 4 x64 cores, 16 GB | 41 s | 90 s | 2 min 33 s |

Run [41551670346](https://github.com/runlith/tagma/actions/runs/41551670346), both green. The typecheck checks packages one after another, so wall time follows the speed of one core and not the count. That is why the 4-core Linux runner was slower than the 3-core M1. A faster typecheck in CI would come from checking independent packages in parallel. After the comparison the workflow keeps only Linux: macOS stays for checks that need it.
