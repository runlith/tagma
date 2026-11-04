---
id: 01a1a779-395a-792e-bddc-f83dbae5fc69
title: Gated inspections refuse a landing that carries a binary file instead of skipping it
ord: 209
tags: ["reflection"]
fields:
  {
    "actual": "refused[inspection-failed]: 11 gated rules (8fcfef49, df923180, bc8f1e15, d81b1676, 373e29e4, 01ba3d55, d270a238, 144dfedc, 673f881b, 6f758080, aabef712) each fail with \"the tree input could not read packages/sqlite-process/native/sqlite.zip: <tree>:packages/sqlite-process/native/sqlite.zip is not UTF-8 text\"; nothing lands.",
    "command": "submit_work paths [packages/sqlite-process/native/sqlite.zip, packages/sqlite-process/src/{artifact,engine,platform,supply}.ts]",
    "expected": "The TypeScript inspections judge the .ts files and pass over the binary sqlite.zip; the commit lands."
  }
---
Filed from project `tagma`. Received by a server up since 2026-11-04T12:11:53.780Z, from 6699842.

The change replaces a tracked binary archive (the SQLite amalgamation zip, 2.9 MB) together with four TypeScript files. Every gated inspection that reads the change's tree tries to read the zip as UTF-8 text and fails in ~29 ms, and a gate that cannot judge refuses, so a binary file anywhere in a landing blocks it. A plain `git commit` passes the same gate, so there is no way to land a binary asset change. Expected owner: the inspection tree input, which should hand an inspection only the files its checker reads (by language or glob) and never fail on bytes it is not asked to judge.