---
id: 01a0ca97-bbc3-79f9-a6ca-c3a81c572b80
title: Three declared browser doors ship Node built-ins to the app, and the boundary assertion that forbids it is red at HEAD
ord: 29
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0cabe-17dd-7be2-91ad-9d1e1a516efb",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca94-63c5-789a-9e91-c36105042d40
sources:
  - kind: file
    ref: apps/tagma/server/src/boundary.test.ts
  - kind: file
    ref: apps/tagma/server/src/composition/catalog.ts
  - kind: file
    ref: apps/tagma/server/src/http/contract/wire/Api.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/tools/presentation.ts
---
`bun test src/boundary.test.ts` in `apps/tagma/server` fails on `the door and the protocol tree reach no Node built-in` with twelve edges. Seven pass; this one does not. `git status` over the three doors, `packages/agent/src` and `packages/llm/src` is clean, so it is committed breakage and not a writer's unfinished edit.

Measured one entrypoint at a time, exactly three of the fifty-one declared doors carry it: `./api`, `./protocol/operations` and `./harness/toolPresentation`. The other forty-eight reach no built-in. The edges are `node:crypto` from `packages/agent/src/thread/compaction/ThreadRequestMeter.ts`, `thread/run/ThreadQuestion.ts`, `thread/compaction/projection.ts`, `thread/run/ToolQuestion.ts` and `agent/AgentRuntimePolicy.ts`; and `node:http`, `node:https`, `node:stream`, `node:zlib`, `node:buffer` and `node:crypto` from `packages/llm/src/llm/route/transport/verbatim.ts`, `route/transport/connect.ts`, `protocols/devin.ts` and `protocols/shared.ts`.

The cause is a door of this package opening a door of the kernel that the kernel does not declare browser-safe. `protocol/operations/*` imports `@runlith/agent/thread` and `@runlith/agent/permissions`; the kernel declares eight browser doors — events, fold, tool, page, catalog, protocol, transcript, collaboration/label — and `./thread` is not among them. The llm reach comes through `@runlith/llm/models` from `api/*`.

This is not hypothetical: `apps/tagma/app` imports `@tagma/server/protocol/operations` five times and `@tagma/server/harness/toolPresentation` twice in non-test code, and the client is built from the door's own declaration, so everything a declared entrypoint reaches is bundled.

Fix it at the owner — the type or value each door actually needs, taken from a browser-safe door of the kernel or restated in the protocol tree — not by widening `browserRefuses` or removing the assertion. Proved when `bun test src/boundary.test.ts` is green with all eight assertions and the three doors still answer what the app imports them for.