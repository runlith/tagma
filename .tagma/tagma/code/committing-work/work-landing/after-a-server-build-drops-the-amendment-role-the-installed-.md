---
id: 01a183d7-995c-74d0-9a3d-afdec9b82f6f
title: "After a server build drops the amendment role, the installed #proposal tag no longer reads and every submit_work in the project refuses inspection-failed"
ord: 141
tags: ["reflection"]
fields:
  {
    "actual": "Refused inspection-failed: \"this project's vocabulary does not read … 3e2c9f4e (#proposal): fields: Expected \\\"line\\\" | … at [\\\"ops\\\"][\\\"name\\\"]; roles: Expected no excess property at [\\\"amendment\\\"]\"; no commit in the project can land",
    "command": "submit_work paths=[packages/markdown/src/render.ts, …] tasks=[1904c5b6] in checkout feed-e2e (project 5)",
    "expected": "The commit lands, or the server migrates or withdraws the stale installed #proposal declaration itself when its build no longer ships that type"
  }
---
Filed from project `tagma`.

The running build is head-20261028T183751788Z; its instruction delta to this thread said "Withdrawn: tag #proposal", but block 3e2c9f4e (#tag proposal, identity shipped core/proposal, field `ops` of schema `amendmentOps`, role `amendment`) still stands in the feed-e2e graph tree. The opening re-measurement in enforcement/rules/reach.ts unreadVocabulary refuses the whole landing on it. The unblock only says "fix the reported inspection failure"; the caller has no door that removes a shipped declaration the server itself withdrew. The commit's own format step had already rewritten packages/markdown/src/render.ts in the working tree before refusing.