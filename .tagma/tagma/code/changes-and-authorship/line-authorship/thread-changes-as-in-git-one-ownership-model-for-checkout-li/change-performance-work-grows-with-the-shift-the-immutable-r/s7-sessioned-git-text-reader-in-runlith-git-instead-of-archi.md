---
id: 01a11681-3d09-70d2-97f5-12e376c9db4f
title: "S7: sessioned git-text reader in @runlith/git instead of archive, tar, and the unpack worker"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11682-7256-76e0-973e-15bd4489ae06",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1166f-7113-7752-b6b9-0a78f16c4571
---
Implement requirement 5 of the [[f16c4571|performance spec]] in the main checkout: sessioned object reading in `@runlith/git`, working- and staged-text transition, archive/tar/unpack removal. The reader contract and limits live in the [[09fbaa34|raw-oid and working-form note]]. No `change-record` code changes.

Built: raw `cat-file --batch` through `Git.objects`, pipelining, restart and scoped cleanup, fresh loose/packed objects; a single LRU of raw objects and trees keyed by (object store, oid), 1/1024 of machine memory budget; revision path resolution over tree objects and a trie; fresh index/attributes/config; per-object conversion; isolated per-path results. The session has a span. Binary answers and stdin go on the existing `ServingGit` platform road; the managed stdin/binary execution contract is outside the delivery. A full stdout with a gap now refuses even when the caller never asked for capture.

Verified: `packages/git`, `packages/agent-tools`, `apps/tagma/server` typechecks; kit integration suite — 77/77 before the last contract tests were added; the final targeted `objects.itest.ts`, `working.itest.ts`, `admission.test.ts` run — 12/12; consumers `threadFiles.itest.ts`, `submitEnds.itest.ts`, `submitIndex.itest.ts`, `ownGit.test.ts` — 30/30. Rule checks found no violations. Independent correctness and performance reviews ran; confirmed framing, queue, stdout-gap, and binary-road defects are fixed.

Sample 2026-10-07, Apple M2 Max, 32 GiB, Bun 1.4.2, Git 2.50.1: 1000 paths with the same 1050-byte text, all 1000 answers verified. Source reader with an available unpack worker: 160.40 ms / 3 git processes cold, 156.33 ms / 3 warm. New: 61.50 ms / 4 processes cold, 35.11 ms / 2 warm. This compares sources, not a reproduction of the missing worker in the old install. A separate integration contract uses 1000 distinct oids and checks the constant process count.

The acceptance system test of the shared large Holdings fixture stays the [[bd19ac52|budget task's]] work, not this kit delivery's.
