---
id: 01a18e49-0903-77d5-bbaa-a40089435c21
title: Vendor-run ACP extension promises are checked before a session opens
ord: 201
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a18cbf-97fc-7f17-bc60-685157787448
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/opening.ts
---
A vendor-run ACP profile (`hosts: null`) cannot borrow Tagma's hosted-session rebuild guarantees: its fork, rewind, native compaction and session-aside promises require the corresponding extensions to be both allowed by the profile and announced by the agent. Missing evidence ends launch with `harness-contract`, naming the capability, before opening or resuming a session. This check does not certify observational guarantees: law, file touch and authorship come from calls and records; measured usage comes from turn-update metadata, not an initialization capability; continuation means taking another turn without new words, not loading or resuming a session. Foreign compaction is journal-based. Hosted profiles retain their separate contract, including fork and rewind through vendor extensions or journal rebuild.