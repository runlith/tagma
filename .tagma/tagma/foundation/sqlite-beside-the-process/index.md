---
id: 01a0c6ef-834d-72bb-a092-d74196b75e80
title: SQLite beside the process
ord: 2
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/channel.ts",
        "for": [
          "edf810fe",
          "f37a2606"
        ]
      },
      {
        "at": "src/connection.ts",
        "for": [
          "edf810fe",
          "f37a2606"
        ]
      },
      {
        "at": "src/ReaderPool.ts",
        "for": [
          "edf810fe",
          "f37a2606"
        ]
      },
      {
        "at": "src/SqliteProcess.ts",
        "for": [
          "edf810fe",
          "f37a2606",
          "bbed8039",
          "13182a9f",
          "d962023e",
          "ab05dfec"
        ]
      },
      {
        "at": "src/ProcessPool.ts",
        "for": [
          "edf810fe",
          "f37a2606",
          "bbed8039",
          "13182a9f",
          "6cc306ce",
          "d2a60527"
        ]
      },
      {
        "at": "src/artifact.ts",
        "for": [
          "f37a2606",
          "6cc306ce",
          "d2a60527"
        ]
      },
      {
        "at": "src/engine.ts",
        "for": [
          "edf810fe",
          "7abcb9a1",
          "bbed8039",
          "feef9784"
        ]
      },
      {
        "at": "src/testing/",
        "role": "testing"
      },
      {
        "at": "src/children.ts",
        "for": [
          "13182a9f",
          "f37a2606",
          "d2a60527"
        ]
      },
      {
        "at": "src/programs.ts",
        "for": [
          "edf810fe"
        ]
      }
    ],
    "id": "@runlith/sqlite-process",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c83d-be5e-7beb-99fc-b3492a74de70
  - kind: imports
    to: 01a0fd8b-bf12-7d39-abd6-b5ffc43d3272
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
  - kind: imports-tests
    to: 01a16b71-3a1f-7cfb-a633-2283feef9784
sources:
  - kind: dir
    ref: packages/sqlite-process
---
Runlith stores are SQLite files, and synchronous `bun:sqlite` runs in child processes so a query never stops the server's event loop. The package owns connections, Bun IPC and the shared reader-process pool; each store's writer stays a separate process, and outside stays an Effect `SqliteClient` without streams. The caller sets files and the reaction to connection loss and hands one `ProcessPool` to all stores of its runtime: the server binds mirrors to the machine store's pool. Where statements run is decided by whoever builds the pool: the product takes child processes, test worlds the same protocol in their own process.
