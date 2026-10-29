---
id: 01a0f58f-665f-7de2-8570-8a5b581bae10
title: Judge reverse import impact when resolver inputs or targets change
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f502-a804-7296-8f0b-ab59c01d62b9",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-04fc-7cb9-bf49-deb7bedb212a
---
Implement §4.5 of the [[bedb212a|adopted decision]]: changing manifest dependencies/exports, the resolver configuration, an alias, deleting a target, or the appearance of a shadowing file extends judgement to affected unchanged importers. The selection owner is enforcement; import and resolution facts are code-facts, with no upper-module logic in kit. Index over the immutable tree; where knowledge runs short — a measured full read of the affected area, changing cost, not verdict; no consumer TTL/cache and no silent skipping. Acceptance: minimal public fixtures proving incremental/full equality and refusal of a fresh violation in an unchanged importer for the stated reasons; source-bound cost limits, typecheck, tests ≤1 min/≤3 workers. Very complex class, Opus xhigh. Never change live policies, never convert gates, never run restart/trust-root. Claims go through Muse; lifecycle and decisions are performed by the owner.
