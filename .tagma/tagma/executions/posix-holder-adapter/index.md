---
id: 01a12759-8915-7d38-82d6-94c9921755ee
title: POSIX holder adapter
ord: 38
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": ".",
        "for": [
          "d2a60527"
        ]
      },
      {
        "at": "testing/",
        "role": "testing"
      },
      {
        "at": "credentials.ts",
        "for": [
          "f37a2606",
          "d2a60527"
        ]
      },
      {
        "at": "endpoint.ts",
        "for": [
          "f37a2606",
          "d2a60527"
        ]
      }
    ],
    "id": "posix-holder",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: imports
    to: 01a0fd8b-bf17-7729-bc6f-2284f37a2606
  - kind: imports
    to: 01a12792-64d6-7374-bc46-a942ec75f4da
  - kind: imports
    to: 01a12893-cecf-7798-9b3d-e2ed4a42e855
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/execution-host/src/posix
  - kind: file
    ref: packages/execution-host/native/src/channel.rs
  - kind: file
    ref: packages/execution-host/native/src/reactor.rs
---
Host logic on macOS and Linux talks to the holder through one POSIX adapter: it fills the holder client's `Link` — the socketpair channel, fd receive over SCM_RIGHTS, their I/O through the native library and readiness, launch preparation with program lookup — and implements the process-table, evidence, platform-facts, tempo, endpoint, and credentials ports; the macOS differences live inside the adapter. The holder client owns the frame protocol and the `Holder` port's execution assembly; the host core decides launches, deadlines, and status collection.
