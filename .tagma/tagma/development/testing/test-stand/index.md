---
id: 01a16b71-3a1f-7cfb-a633-2283feef9784
title: Test stand
ord: 3
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/bun.ts",
        "role": "testing"
      },
      {
        "at": "src/vitest/",
        "role": "testing"
      },
      {
        "at": "src/fixture.ts",
        "role": "testing"
      },
      {
        "at": "src/core/ledger.ts"
      },
      {
        "at": "src/report.ts"
      },
      {
        "at": "src/worlds.ts",
        "role": "testing"
      },
      {
        "at": "src/memory.ts",
        "role": "testing"
      },
      {
        "at": "src/slots.ts",
        "for": [
          "48c1dabd"
        ]
      },
      {
        "at": "src/schedule.ts",
        "for": [
          "48c1dabd"
        ]
      },
      {
        "at": "src/core/files.ts",
        "for": [
          "48c1dabd",
          "a287d79f"
        ]
      },
      {
        "at": "src/sampling.ts",
        "for": [
          "96b75e80",
          "48c1dabd"
        ]
      }
    ],
    "id": "@runlith/testbed",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c6ef-834d-72bb-a092-d74196b75e80
  - kind: imports
    to: 01a0fd8b-bf14-78e1-9fb7-466fe707d6ca
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/testbed
---
Every runlith test file stands on this package: a unit file gets a refusal at the call site when it touches a process, disk, socket or SQLite, the network is closed for all files, home, XDG, git identity and TMPDIR are isolated, the guard fails a file that leaves a process running, and the run report lays each file's cost out as load, guard, world, tenant, body and children by kind. The dependency-free kernel is wired by both runners — Bun through a preload the CLI adds to the run and which may stand in bunfig.toml, Vitest through a setup file and global setup — and scripts start the runner through `testbed`, which writes the run line, holds the timings file and prints the seed. The CLI splits the machine between runs by a process budget on an advisory flock and itself sets the runner's worker count from the share it got; the scheduler starts sets side by side on free units — both `test:all` and `check:change` account for them this way, and the stand sets no run lifetime. An e2e file is selected by `testbed e2e`, separately from unit and integration discovery; its worker holds a browser-sized family of machine-budget units, and `testbed e2e --program` gives a standalone measuring command that same budget and report root. A test does not fail for running long: the stand's only timeout is a 3-minute hang guard per test and hook, and a test past its kind's threshold (1 s unit, 10 s integration or e2e) passes and enters the report as a `slow` line — CPU of the test with its children, the share of time not covered by measured CPU, world, tenant and its file's processes — which `check:change` prints to the agent; a nested testbed inherits the living holder's units, time and CPU spent in the queue never enter the run cost, and a dead holder's units are freed by the OS kernel. A Bun file takes environment, cost accounting and guard before its first hook: registration interception is shared for ESM and `require('bun:test')`, including a warmed helper from the worker's previous file. Worlds and their tenants stand on this package but are built at their own owners. The memory entry substitutes an in-memory FileSystem using the existing @effect-vfs/memory with a shared conformance on a real disk; state belongs to one layer build. The stand tells the auditor a path's canonical belonging to its run, file and world directories; a reference from them outward gains no belonging. Whether a test is fit, the package does not decide.
