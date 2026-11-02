---
id: 01a19a1a-0967-79f7-b795-3ebc3c6c0010
title: OpenCode 2.1.3 native fork preserves the tested request prefix; nested forks change cache affinity
ord: 8
tags: ["research"]
fields:
  {
    "source": {
      "name": "OpenCode V2 native fork and model request composition",
      "ref": "@opencode/{cli,client,plugin} 2.1.3; https://github.com/sst/opencode/tree/v2.1.3; offline boundary test 2026-11-02"
    }
  }
edges:
  - kind: relates
    to: 01a17319-75a7-7026-b6a0-72189d725189
---
Read on 2026-11-02: installed `@opencode/{cli,client,plugin}` 2.1.3 and the official `sst/opencode` source at tag `v2.1.3`. Source paths below are relative to https://github.com/sst/opencode/tree/v2.1.3.

`packages/core/src/session.ts` exposes a native `session.fork({sessionID,before?})`; the boundary is exclusive when `before` is supplied. `session/projector.ts` copies settled messages' data, including reasoning and provider-bound metadata, remaps storage message ids, adjusts compaction keep ids and gives the new session a fresh identity. `session/runner/to-llm-message.ts` retains reasoning/native metadata for the producing model and derives tool calls/results from their preserved call ids. The fork also inherits the source's current instruction baseline, rather than its historical baseline at the selected cut.

`session/model-request.ts` composes tools in the order of the context hook's entries, system and history from that hook, and cache identity from `SessionAffinity.get`. The adapter's context hook replaces the system and publishes only the prepared tool definitions; it is refreshed for each turn, so there is no process-latched MCP list to recover. `session/affinity.ts` selects `parentID ?? fork.sessionID ?? id`. A first-level native fork consequently retains its source's affinity, but a fork of that fork changes it to the intermediate session id. The request producer derives `promptCacheKey` from that affinity and explicitly notes the missing root lineage. The public context hook cannot override that top-level key; the model-request hook can change headers/base URL only. Header/body rewriting for individual providers is not an owner-level repair of this vendor limitation.

Offline measurement: `packages/adapter-opencode/src/runner/sdk.itest.ts` drives the real pinned CLI in isolated account/config directories against a local scripted HTTP upstream, without account credentials or vendor network. Before native-fork wiring the ACP extension was absent. The first native-fork comparison then found a new environment-update user message, because each runner set TMPDIR to its own scratch/config directory. Moving that temporary root to the shared account removed the producer's environment change. The resulting first-level fork and source next requests have identical serialized JSON bodies, including ordered tool definitions, retained reasoning, image/tool history and `prompt_cache_key`, and identical `x-session-affinity`. The same comparison succeeds when the source advances before the pinned copy opens. An inherited-address cut also excludes the addressed turn after the vendor's message-id remap.

This proves the exercised OpenAI-compatible HTTP route on one pinned vendor build, not every OpenCode provider, WebSocket transport, historical instruction-baseline mutation or nested-fork cache identity. No real model request or provider cache accounting was observed.
