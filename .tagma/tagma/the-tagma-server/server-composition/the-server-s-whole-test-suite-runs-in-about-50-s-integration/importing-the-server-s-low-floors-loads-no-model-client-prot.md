---
id: 01a0d82d-4392-70ce-a335-67c8e8510b18
title: "Importing the server's low floors loads no model client: protocol/ and db/ stop pulling @runlith/llm, protobuf, domino and ajv, and entry points hold a measured load budget"
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d82d-7f19-77c5-81cd-81baa83b2117",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d68a-bb77-75a9-bc81-6742e24637ca
sources:
  - kind: dir
    ref: apps/tagma/server/src/settings
  - kind: file
    ref: apps/tagma/server/src/composition/testing/graphFixture.ts
---
**Measured on 2026-09-25.**
- Importing `graph/core/graphFixture.ts` loads 1503 modules and takes about 0.7 s of processor time; `http/doorFixture.ts` takes about 0.9 s.
- Among them:
  - `packages/llm` — 79 modules;
  - `@bufbuild/protobuf` — 66, the Devin wire;
  - `@mixmark-io/domino` — 52;
  - `ajv` — 63;
  - `zod` and `zod-to-json-schema`;
  - `packages/agent` — 147.
- `protocol/settings.ts`, the lowest floor, imports `@runlith/llm`, and so do `protocol/modelSelection.ts`, `modelCatalog.ts`, `accountQuota.ts`, `harness/{codex,claude,devin}.ts` and `db/thread.ts`.
- Every integration file pays this before its first test: 336 files × ~0.75 s ≈ 250 s, a third of the integration layer's processor time. `tagma --help` takes 0.4 s, and every CLI hook an agent runs and every server start pay the same.

**Why this is the fix.** It is the owner's defect: a vocabulary floor that depends on the model client. Dropping `--isolate` and merging files were rejected: isolation is what keeps files independent and the per-file guard working, and merging only hides the cost.

**Do:**
1. Measure where the load time goes — per module and per top-level evaluation — for the fixture entries, the CLI entry and the server entry.
2. Cut the edges at their owners. `protocol/` keeps the vocabulary and names model facts without importing the client. Heavy modules load where they are used. Top-level work that is not needed at import becomes lazy. `protocol/` stays browser-safe; check what the surface's bundle loses or keeps.
3. Hold it:
   - a measured load budget on those entries, so a regression fails, not a guess;
   - the package-import boundary written as law. Coordinate with the architecture thread 01a0d3dc, which owns enforcement, on whether it is a `package-boundary` test or an enforced rule.

**Done when:**
- the import cost of the fixture entries, the CLI entry and the server entry is named before and after;
- the integration layer's summed processor time is re-measured;
- the budget and the boundary stand.

## Built

Commits 0a7b3dc658, b8d4b86ea6, 3898e1966b, c0928c6449, 2a978273f6, 0898f6b063, 28fd0c9579, 4aa8f610cb. Reviewed once by Opus; its findings are fixed in 4aa8f610cb and in the claims.

- **The low floors' three client edges:** `doctrine/render.ts` and `install/machineWorld.ts` take `hostWorld` from the new door `@runlith/agent-tools/world` ([[efe15ed9]]), and `graph/orientation/Touches.ts` takes `threadAgentLabel` from `@runlith/agent/collaboration/label`.
- **Heavy leaves load at first use:** sharp ([[6593ce23]]), the Bedrock event-stream codec ([[08621d3e]]), turndown and htmlparser2 ([[55e8c87f]]), and the MCP client SDK with ajv and zod ([[b18c3ccf]]).
- **Barrels:** every `@effect/platform-bun` import is a module subpath (the barrel loaded `effect/unstable/cluster`), and `protocol/refusal.ts` and `graph/` take `HttpApiSchema`, `HttpClient` and `FetchHttpClient` by subpath.
- **The budget:** [[697b4ccc]].
- **The boundary:** rule [[0d2c66a9]], written by the architecture thread and enforced at gate at landing with no debt.

Measured with modules counted from `require.cache` in a fresh process:

| entry | modules before → after | processor time |
|---|---|---|
| graph fixture | 1503 → 706 | 0.71 → ~0.40 s |
| door fixture | 2170 → 1707 | ~1.1 → ~0.8 s |
| `http/runtime.ts` | 2061 → 1598 | ~1.15 → ~0.82 s |
| `tagma --help` | — | 0.80 → ~0.30 s wall |
| `cli/hooks.ts` | 594 → 597 | unchanged |

The processor-time figures were taken on a machine at load 9–20.

The integration layer was measured load-only: each of the 336 `*.itest.ts` files (the list of 2026-09-25) was loaded with a test-name pattern that matches nothing, one at a time. That load cost summed to 323.5 s before and 248.2 s after; the graph files went from 50.0 s to 30.5 s.

## Divergences

- **`protocol/` and `db/` still import `@runlith/llm`, through its fact doors `./models` and `./schema`: 27 modules.** They no longer reach the model client: no `llm/route`, `llm/protocols`, protobuf, domino, ajv, zod or MCP SDK. This follows "names model facts without importing the client" and the allowed doors of [[0d2c66a9]]. It does not follow the title's "stop pulling `@runlith/llm`".
- **The integration layer's full processor time was not re-measured.** The operator forbade whole-suite runs, so only the load-only sweep above was taken. The full figure belongs to the whole-suite measurement of [[e24637ca]].
- **A hook is not cheaper.** It loads the whole HTTP API declaration: `api/` with 115 `protocol/` modules and the `effect/unstable/httpapi` barrel.

## Open

- Devin's wire still loads `@bufbuild/protobuf` (66 modules, ~35 ms) with the client, in the door fixture and at server start.
- A hook's API declaration is still loaded whole.