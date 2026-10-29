---
id: 01a14b75-1dfc-732d-bf66-797ec73a2739
title: Only the tool input's display projection names a running call in the feed, so it is required in every declaration
ord: 6
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a14b61-0c47-7ef3-a420-fdb4bfca2216
sources:
  - kind: symbol
    ref: packages/agent/src/agent/tool.ts
    symbol: ToolDeclaration
  - kind: symbol
    ref: packages/agent/src/agent/tool.ts
    symbol: toolPartialDisplay
---
While a call has no answer, the feed names its subject ("Searching the web for …") only from `display.title`. That title comes from one place — the `display` projection of the input declared in `Tool.make`: streaming of arguments (`toolPartialDisplay` on each closed field), preflight (`toolDisplay` over the parsed input), and the hosted road (`ThreadHosting.display`) all read it. The answer's display arrives only after execution and then outranks the projection.

So `display` is required in `ToolDeclaration`. While it was optional, tools (websearch, webfetch, grep, glob, ls, the vendor web) put the subject only in the `ToolAnswer` and hung unnamed until the answer. A tool with no subject declares it explicitly: `() => ({ form: 'none' })`. Graph operations (`nativeDeclaration`), ready answers, ask_user, and MCP tools with no kind are declared this way now; their running calls still have no subject.

The projection also takes the partial input, in which only closed fields from `streamFields` are present. So its input is typed partial (the schema's `Partial`), and typecheck catches reading a field that may not be there yet. The model input is raw while the type promises decoded, so `toolPartialDisplay` passes into the projection only fields that decode under their field's JSON codec; the rest are absent to it. Without this, an off-type value (`incarnation: "167"` instead of a number) landed in the typed `reference` of the call entry, and the entry stopped reading by its schema. A tool without Struct fields (MCP) takes the input as is. The `message` body reaches the feed only when the projection returned a non-empty string.

Preview is presentation: a call, its answer, and history without it are the same. So all three roads count it through activity degradation (`previewed`, on the synchronous hosted road `degradedSync`). When the projection or the body limit throws, the call runs with no title while the failure lands as a `degraded` note in the operator's error list. `toolPartialDisplay` itself does not swallow exceptions: otherwise a failure would vanish silently.
