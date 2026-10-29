---
id: 01a127fd-4a7d-7485-8de9-4436849363d3
title: JSON Schema operation params and tool.parameters promise models null for optional fields, but decode rejects it
ord: 5
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a127f0-b2c2-7874-a236-cb257814300f
sources:
  - kind: file
    ref: packages/llm/src/llm/schema/messages.ts
---
For `Schema.optional(X)`, Effect 4.0.1 derives `anyOf [X, null]` into the JSON Schema: the JSON Schema is built from the JSON codec (`Schema.toCodecJson`), where `undefined` ↔ `null`, and that codec accepts `{ x: null }`. Our decode goes through the type codec and rejects `null` (verified by execution). Models see this JSON Schema: operation params are published via `toolInputSchema` (`packages/llm/src/llm/schema/messages.ts`) from `invocation` and `composition/cli`, and the `agent` package's `tool.parameters` go there too; nested schemas of contribution points (`views/contract/wire/points.ts`) go through the plugin manifest. After swapping `optionalKey` for `optional`, there are more such fields. A model sending `null` on the schema's promise gets a refusal and burns a step.

Fixed in `367dae099b`: HTTP ingress — through it the CLI and MCP catalog — MCP proxy, tool arguments, and plugin manifests decode with the same schema's JSON codec. One `jsonCodec` in utils caches the codec per schema instance; plugin points compile the optional form at declaration, including `contributes.<point>: null` as an absent contribution. Repeated derivation of optional null is removed from model-dialect; string-number, boolean, and single-element conversions are kept. The in-process type form of operations did not change. The boundary contract is recorded in the [[1354bedb|note]].

Typecheck of utils, llm, agent, and server passed. The new HTTP contract `read_operations` accepts optional null with the same response as a missing field; 27 agent, 11 schema, 1 input, and 8 HTTP tests are green. Probes confirmed nested optional null and an absent whole plugin point, MCP proxy, and JSON-codec reuse with the type codec's refusal of null intact. The first run of the HTTP file exceeded 10 s in beforeAll followed by OwnGitFailed; comparison on 5337894fba (8/8, 5.00 s) and a full rerun in optional-fields (8/8, 8.38 s) did not reproduce the failure. The cause of the initial delay is undetermined; cold-boot stability under the original load is unproven. The operator's live server was not restarted; the separate baseline worktree is deleted.
