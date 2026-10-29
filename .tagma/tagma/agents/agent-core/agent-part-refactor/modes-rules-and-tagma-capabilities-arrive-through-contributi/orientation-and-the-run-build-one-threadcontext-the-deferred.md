---
id: 01a11c10-977e-7c0b-8198-fda2dbba1d1b
title: Orientation and the run build one ThreadContext; the deferred inventory comes from the run's resolved source contributions
ord: 2
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a11901-5360-733e-9ca2-9126863f579c
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/composeAgent.ts
---
Sources in the registry (skills, MCP, collaboration, fork, resources, user questions) are currently resolved twice per run: orientation (`ThreadAgent.runContext`) builds a catalog through `agentCatalog` against the orientation context for the deferred-tool inventory, and the run builds it again against the run context. MCP writes `mcpBound.bound` twice in the process. The hosted road (`ThreadHosting.open`) does the same, even though by orientation time it already holds the run's resolved catalog (`hosted.handle.catalog`).

The registry contribution resolved for orientation cannot be reused: `threadContext` resolves target, world, and source roots by `use` (`native-harness/turns/context.ts:149,164`), so the orientation context and the run context are different resolutions. Tools built against one must not be handed to the other.

To do: `ThreadAgent` builds one context per run, and both orientation and the first-step catalog read it (`thread/agents/ThreadAgent.ts` `runContext` and `run`; `thread/run/assembly/RunAssembly.ts` `oriented`). The deferred-tool inventory comes from the catalog the run already resolved, not from a second resolution at orientation.

Done when a test proves: skills and MCP resolve once per run, and the deferred-tool inventory in the turn context matches the run's catalog.
