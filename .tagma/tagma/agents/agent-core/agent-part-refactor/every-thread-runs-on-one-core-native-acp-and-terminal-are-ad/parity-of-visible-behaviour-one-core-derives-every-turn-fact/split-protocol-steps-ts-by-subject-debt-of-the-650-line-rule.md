---
id: 01a14e40-b326-7913-8625-9caf0cdc65a3
title: "Split protocol/steps.ts by subject: debt of the 650-line rule"
ord: 16
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14cfa-01b6-73d1-ab67-0e20a204ca15",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14e22-df0f-7912-ab76-2362d2cbdb5d
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/steps.ts
---
`ProtocolSteps` holds several subjects: link assembly (`link`), the step machine and its durable write (`run`, `saved`, `persist`), the turn end outside a step (`close`, `lapse`), the accounting of presented hosted calls (`introduced`, `opening`, `recorded`, `known`, `unsealed`) and the parsing of write receipts (`settle`, `landing`, `deliveredAsk`). The file keeps crossing 650 lines from different tasks' edits (last — d2cbdb5d, +4 lines of tail-reset flag). Split it by subject; the first candidate is the hosted-call accounting, with its own state and its own reader (`reached`).

## Outcome

Commit e4f51fde16. The presented-hosted-call accounting moved to `protocol/introductions.ts` (`HostedIntroductions`, one instance per driver, shared by `ProtocolSteps` and `ProtocolRuns.reached`), and `boundedAsks`/`boundedClient` moved to `protocol/calls.ts` next to `boundedCall`. steps.ts dropped below 650 lines, the 6b3210c7 rule-debt record is re-measured away (14 → 13). Behaviour unchanged: protocol stests 108/108, parity 77/77, external-harnesses unit 289/0; Sol's review with no behavioural findings, the [[ae10d61d]] explanation gained the introductions.ts source.
