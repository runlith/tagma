---
id: 01a128c3-c5a6-7cdb-9ed7-cf8768c00662
title: Typecheck of server, agent, and agent-tools fails on services of the generic jsonCodec
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a128b8-870b-7f4c-b76d-0596da89f514",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a128be-f59d-7c30-8434-2c534727a7a6
sources:
  - kind: file
    ref: packages/utils/src/codec.ts
---
`bun run typecheck` in `apps/tagma/server` on HEAD `0ac48a20a3` yields 20 TS errors, all around `jsonCodec` from `@runlith/utils/codec` (commit `367dae099b`): with a generic `S`, `Schema.decodeUnknownEffect(jsonCodec(schema))` infers services as `Schema.toCodecJson<S>` instead of `never`.

Places: `packages/agent/src/agent/ToolArguments.ts:58`, `apps/tagma/server/src/composition/http/operations.ts:26`, `apps/tagma/server/src/invocation/contract/service/input.test.ts`, `packages/agent-tools/src/{filePages,tools}.itest.ts`, `apps/tagma/server/src/composition/testing/native-harness/graphTools.itest.ts`.

Likely cause is the `S extends Schema.Constraint` bound on `jsonCodec`: `Constraint` has no typed `DecodingServices`/`EncodingServices`. Done when typecheck of server, agent, and agent-tools is green.

Separately: in the shared checkout `packages/utils/node_modules` had no `effect`, though `bun.lock` already carried it; `bun install --frozen-lockfile` linked it with no lock changes.
