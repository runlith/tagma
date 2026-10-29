---
id: 01a1126e-31cc-7226-923d-842ffb3d9202
title: An operation declaration splits the call right (`callers`, checked on admission) from the agent tool (`tool`); git-panel buttons are not agent tools
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/invocation/consent.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/wire/operation.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/contract/wire/checkoutActs.ts
---
An operation declaration answers two independent questions with two fields: who may call it (`callers`), and whether it is handed to the agent as a tool (`tool`). The call right is checked on call admission the same way for every entry point. Git-panel buttons stop being agent tools.

## What is broken now

- **`audience` reads like a right but works only as an offering.** A thread calls an operation with `audience: 'operator'` through `tagma op` and gets an answer: verified on `read_remote_access` from the shell of a native thread with `TAGMA_SESSION_GRANT`. `read_provider_token`, `create_pairing`, and `restart_server` are reachable the same way. The only consumers of `audience` are the declaration type, the registry line (`invocation/registry.ts`, `registryEntries.ts`), and the `OPERATOR_ONLY_OPERATIONS` list, which only a test reads.
- **`doors.agent: false` reads as "the agent may not", meaning "no tool".** Transport (`http`, `socket`) and the agent tool live in one `doors` object, so the tool is copied along with the transport.
- **That is how git-panel buttons became agent tools.** In `workspace/contract/wire/checkoutActs.ts`, all eight actions (`stage_checkout`, `unstage_checkout`, `discard_checkout`, `commit_checkout`, `abort_checkout`, `fetch_checkout`, `pull_checkout`, `push_checkout`) are built from the `ACT` constant with `doors: CHECKOUT_DOORS` — the doors of the checkout reads from `checkoutReads.ts`, which include `agent: { capability: 'worktrees', needs: ['shared'] }`. Arrived in `e950290341`; there is no decision anywhere to hand them to the agent. The agent does not need them: it commits through `submit_work` or git in `bash`. And `commit_checkout` from the agent bypassed the confirmation that `git commit` gets in `bash`, and in the native path fell over on a missing `CheckoutJudgement` ([[da1db44a]]).

## What is needed

1. **Declaration fields** (`platform/contract/wire/operation.ts`, `FeedDeclaration`, every catalog declaration):
   - `audience` → `callers: 'operator' | 'thread' | 'any'` — who may call;
   - `doors.agent` → `tool: AgentTool` (today's `AgentDoor`: capability, `needs`, `direct`, `runtime`); no field means no tool;
   - `doors` keeps only `http` and `socket`;
   - the type forbids `tool` with `callers: 'operator'`; with `'any'` and `'thread'`, the `tool` decision is explicit on every operation (field present or explicitly absent — same as today's `false | AgentDoor` requirement; pick the form that a shared transport constant cannot inherit).
   - Rename across the whole catalog and every reader (native door, MCP, registry, `tagma op` catalog, the app if it reads). No old names remain.
2. **Git-panel buttons without `tool`.** The eight actions get their own doors `{ http: true }` with no tool. Checkout reads (`read_checkout`, `read_checkout_history`, `read_commit`, `read_repositories`) stay agent tools.
3. **`callers` is checked on call admission** (`invocation/admission`), for every entry point: native tool, MCP, HTTP, `tagma op`, socket.
   - A thread calling an operation with `callers: 'operator'` gets the operator's word under the thread's mode, through the same confirmation mechanism that already exists (`invocation/consent.ts`, `consentRule`): in trust — a confirmation; in bypass — it passes. The confirmation text names the operation and its meaning (`meaning`).
   - An operation with `callers: 'thread'` called by the operator refuses with a clear code (this is a process protocol, not a human act). If a legitimate reverse case is found, the implementer names it in the report.
   - Before enabling, verify by search and tests that no internal Tagma path calls an operator operation on a thread's behalf (hooks of foreign harnesses, `tagma hook`, workflows); name what is found and move it to the right operation.

## Acceptance

- Among agent tools (native and MCP) there is not one git-panel action and not one operation with `callers: 'operator'` — `composeAgent.itest.ts`.
- A thread calling an operator operation over HTTP / `tagma op`: in trust — `consent-required` (or the operator's question where one exists); in bypass — an answer. The operator passes without a question.
- `commitChecks.stest.ts`: a thread's call of `commit_checkout` over HTTP is still judged by the rules.
- The Checkout page of the app works as before (its tests are green).
- No `audience` or `doors.agent` remains in the code. The whole-workspace typecheck is clean except the already-known `ChatTransport.test.ts:184` error in chat-ui.
- [[54c5fcd2]] is rewritten for `callers` and `tool`.
