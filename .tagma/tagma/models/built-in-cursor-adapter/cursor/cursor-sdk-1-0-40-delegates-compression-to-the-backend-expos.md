---
id: 01a1956a-938a-7891-b349-869681aee933
title: Cursor SDK 1.0.40 delegates compression to the backend, exposes no fill trigger, and hides summary boundaries from onDelta
ord: 18
tags: ["research"]
fields:
  {
    "source": {
      "name": "@cursor/sdk 1.0.40 installed Bun bundle and declarations",
      "ref": "Installed @cursor/sdk@1.0.40, dist/bundled/index.js and dist/esm/*.d.ts; source reading 2026-11-01, no live SDK run"
    }
  }
edges:
  - kind: relates
    to: 01a16401-4e1c-760d-8253-35ee9fe38a12
  - kind: relates
    to: 01a16437-4c54-7470-ac60-eaf74ff4c780
---
Reading of the installed `@cursor/sdk@1.0.40` Bun bundle and public declarations, 2026-11-01. No working SDK key was available and no live Cursor run was made. Earlier readings establish the embedding and authentication surfaces; they do not establish local SDK autocompression.

The local SDK delegates its agent loop to `agent.v1.AgentService.Run` at Cursor's backend. Its public `Agent`/`Run` APIs expose no compaction request, and the bundle contains no local compaction switch, trigger or fill threshold. The wire supports a summarize action, server checkpoints with summaries, and a `preCompact` interaction query carrying trigger and context-fill fields; the traced send path does not construct that action. This proves the backend can communicate compaction, not that every SDK-local session automatically compacts or at what fill. An app-forum claim of roughly 90% does not establish SDK behavior.

In `dist/bundled/index.js` (5,448,845 bytes in the package read), `DT0.run` constructs the run request near byte 2,403,830; `AgentService.Run` is declared near 2,138,789. `InteractionUpdate` contains summary/start/completed variants near 580,972, but `UD0.apply` near 2,197,776 suppresses them from `onDelta` through `xh8` near 2,201,207. Persistence maps summary text to a generic SDK task event (`_m6`, near 5,431,266), while the start/completed variants are dropped. Therefore an adapter's `onDelta` switch over these summary variants cannot observe a real SDK boundary. A generic task event alone is not established as a completed compaction.

The checkpoint callback near byte 5,413,433 saves each server checkpoint; the next send loads that checkpoint and hands it back as `initialState`, preserving vendor state. `ConversationStateStructure` near 562,739 carries summary/archive fields. The public store's checkpoint payload is opaque, so a boundary reader must establish the encoding and an authoritative summary change rather than infer completion from arbitrary task text. SDK-local automatic compression, its threshold, actual overflow response wording, and prompt-cache reads after a real fold remain unverified.
