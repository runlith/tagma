---
id: 01a13fea-5459-7a88-b213-3c5e9a6b9fbe
title: Migrate the catalog and source lifetime tests to Effect
ord: 19
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d30-d804-7b33-9b8b-12527b27377d
sources:
  - kind: file
    ref: packages/agent/src/catalog/resolveCatalog.test.ts
  - kind: file
    ref: packages/agent/src/thread/toolSourceStanding.test.ts
---
Migrate the effectful cases of resolveCatalog.test.ts and toolSourceStanding.test.ts to @runlith/effect-test; leave the pure resolver cases sync. Keep grant/profile/deny/derived/withheld and typed collision, source id release, the unconnected source's refusal and the standing stamp when replacing a registration mid-offer. A full ThreadRow instead of a cast; Deferred drives the race, the fiber belongs to the test scope. Remove pinning of the English collision message, keeping the type and both sides' addresses. Change neither production, scriptedWorld nor the storage port. Checks are each file separately with --parallel=1, bun check -p packages/agent, scoped law, one Sol+Muse round; diff and evidence to the parent before the commit.
