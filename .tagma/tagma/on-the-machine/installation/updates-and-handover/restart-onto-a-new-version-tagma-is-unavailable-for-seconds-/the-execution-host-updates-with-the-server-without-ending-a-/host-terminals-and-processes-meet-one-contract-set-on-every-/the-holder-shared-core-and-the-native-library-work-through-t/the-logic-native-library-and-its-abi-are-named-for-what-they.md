---
id: 01a12877-c4e4-71a5-aac7-b90db9a045cd
title: "The logic native library and its ABI are named for what they hold: execution-platform"
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a127ad-cc0d-7a03-b77a-95f17df613b0
sources:
  - kind: file
    ref: packages/execution-host/native/Cargo.toml
---
Per the "Names" table of spec [[7df613b0]]: crate `execution-pty` → `execution-platform`, `libexecution_pty.dylib` → `libexecution_platform`, ABI prefix `execution_pty_` → `execution_platform_`, with all consumers (build, bundle, server boot, TS ABI, fixtures). Then the rest of the table's rows whose files no other implementer changes. Done when the old names are gone everywhere outside the archive, and the build and narrow tests over touched files are green.
