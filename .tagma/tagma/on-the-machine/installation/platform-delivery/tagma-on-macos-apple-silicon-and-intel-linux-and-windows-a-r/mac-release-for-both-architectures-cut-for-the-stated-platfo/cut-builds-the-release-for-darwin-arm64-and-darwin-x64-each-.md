---
id: 01a175e1-b116-7055-8be6-30fd6e4a06fd
title: "Cut builds the release for darwin-arm64 and darwin-x64: each native part taken for the stated target"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a175e2-d7b9-7514-a0a5-c35770bf654e",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a175e1-b116-7055-8be6-30f9fb401399
---
Release cut hands the `darwin-arm64`/`darwin-x64` target to every native-part producer — release bun, Electron, platform npm packages by `bun.lock`, Rust, SQLite, Whisper, sound helper — and cuts both targets of one release. Cut checks and the trial run execute the target's bun, x64 — under Rosetta. Checkout builds never change. The parts table — in the spec.
