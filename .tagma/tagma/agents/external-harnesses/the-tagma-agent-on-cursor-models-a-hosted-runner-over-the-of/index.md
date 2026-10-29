---
id: 01a16434-fc60-7079-91d8-189b5bb2bceb
title: "The Tagma agent on Cursor models: a hosted runner over the official `@cursor/sdk` local on ACP transport, key login, the `cursor` provider catalog and quota"
ord: 103
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a1050f-fe38-77cf-8806-0bac1249b48f
  - kind: relates
    to: 01a10838-8f2b-7e30-a2b0-7563adb9cd5b
  - kind: relates
    to: 01a16400-d245-7390-a63a-e3826255ed3c
  - kind: relates
    to: 01a16401-4e1c-760d-8253-35ee9fe38a12
sources:
  - kind: dir
    ref: apps/tagma/server/src/external-harnesses/runner
---
## What the user gets

Cursor models stand in Tagma's model picker next to Claude, ChatGPT, and the rest, under the "Cursor" provider with its account. A thread on such a model is an ordinary Tagma agent thread: the same prompt, the same tools, law and approvals on every call, row authorship, commands, reports, model switch in both directions with the same journal. Words mid-turn wait for the turn's end, as with Devin: the SDK's `steer` gives no final answer about a word's fate. Cursor gives only the loop and its subscription models. The transport is never named (rule [[e5eed6b8]]).

Login is a "Sign in with browser" button on the Providers screen (the official `Cursor.auth.login()` issues a user API key) or pasting a ready key from the Cursor dashboard. Several accounts and a default account work as with other key providers. The account quota stands in the same status-bar counters as Claude and Codex.

The terminal `harness:cursor` — Cursor's own agent in the `cursor-agent` TUI — stays as is: it is a different agent, not a different transport of this one. Only that terminal path stands in "CLI agents", with the Cursor mark and a terminal icon; hosted Cursor models are picked in the ordinary picker. Their route never depends on `cursor-agent`, and no key means no fake catalog fills model selection.

## The decision and why

Cursor runs on the official `@cursor/sdk` in local mode, inside Tagma's `tagma harness-run cursor` runner. The runner is an ACP agent over stdio, held by the driver with a held pipes execution of the execution host — exactly as the Claude Code runner ([[d0810682]]). The SDK gives only the loop: Cursor's built-in tools are off (`tools: ['mcp']`), every tool is the native Tagma agent's tool, which the runner hands to the SDK and executes through `call_hosted_tool` with the turn's grant. So the same door as the native agent writes the law, approvals, path touches, and authorship — not the vendor's question judge.

Why this way:

- A native wire provider for Cursor is impossible: Cursor has no inference API, only agents ([[1249b48f]]). So a Cursor model is reachable only through someone else's loop, and Tagma hosts its own agent in it the same way as Claude Code does: inside it.
- **SDK, not `cursor-agent acp`.** Cursor's ACP is its own agent: its own tools, file edits with no permission asked, project hooks never fire in ACP ([[58248ba9]]), the model is picked only by writing the global `~/.cursor/cli-config.json` ([[b0db1a2b]]), and there is no spend ([[4a8fa2cc]]). The SDK gives what the Tagma agent cannot do without: replacing tools with its own (`tools` + `customTools`), a model per `send` with no global side effects, turn spend, `steer`, `cancel`, `resume` from a new process.
- **SDK in the runner, not in the server process and not over an SDK bridge.** In the server, a running turn dies with every Tagma restart, and the heavy SDK (5 MB bundle, protobuf, connect, statsig) would sit in the process holding everything else. The SDK bridge is a second binary and a second protocol over the same SDK; it is needed where there is no Node/Bun, and Tagma has Bun, with the SDK shipping a flat build for `bun`. The Claude runner already proved the shape: the process survives a server restart, the driver rereads stdout from the cursor.
- **T3 Code as the reference** runs Cursor on the same SDK, but its own Cursor agent (built-in tools, its own instructions in the message, `/compress`, steer as cancel plus a new send; [[6255ed3c]]). Its adapter proves the SDK local holds a turn in a product; Tagma does not take its model of "a foreign agent with vendor approvals".

This changes the decision of closed spec [[adb9cd5b]], where Cursor stays on terminal and native and ACP is named the best official road. The reasons: the SDK adapter works in T3 and gives what Cursor's ACP never gives (its own tools, a model with no global write, spend).

## What Cursor never gives and how it is solved

- **`systemPrompt` is closed for external accounts** with no way to enable it (a Cursor employee, 2026-10-19; [[9fe38a12]]). The Tagma turn prompt travels as the first block of the first message of every Cursor session and again when the run's frozen prompt changes. Cursor's own prompt stays underneath. When Cursor opens `systemPrompt`, the runner moves to it with a one-line adapter edit.
- **There is no quota in the official API.** The provider adapter reads it on the `cursor-agent` login — the operator's decision (as T3 does: `aiserver.v1.DashboardService/GetCurrentPeriodUsage` with the CLI login token). A read failure is "quota unknown", not an error.
- **The SDK catalog has no context windows.** The catalog comes from `Cursor.models.list()`; the window comes from the model's `context` parameter, otherwise from the adapter table checked against the Cursor model docs (details in the provider spec).
- **Spend is turn-total tokens, price unknown**: local `getUsage()` is closed for accounts and never links a price to a turn. No context reads happen on every model request; the context ring honestly says "unknown".
- **Fork, rewind, aside, and compression in the vendor session** have no SDK API. Fork and rewind go through the Tagma journal: a new Cursor session is built from the journal with pictures (the first turn reads history with no cache). There is no aside, so there is no automatic recap; a manual one warns of the unknown cache ([[eba592c4]]). Cursor does its own context compression on its server; Tagma writes it to the feed as a compression boundary. Manual Tagma compression runs only on a foreign model with a Cursor session reset: for that, the shared contract gains a "compression only on a foreign model" capability.

## Architecture

Owners and layers, bottom up:

1. **`@runlith/tagma/adapter` and `providers`** ([[ea5c74f4]], [[f92da92b]]): a harness provider gets API-key login (browser or paste) and the selected account's key in the launch environment; a provider may declare an async model catalog, which `providers` keeps as the last good version; a harness provider may declare a quota reader. Today the contract admits a harness only with `auth: 'cli'` (`packages/tagma/src/adapter/declaration.ts:99–103`), and `HarnessAccounts.launch` hands over only a CLI account's folder. → [[3c947db7]]
2. **`packages/adapter-cursor`** — a new adapter package next to `adapter-anthropic`: the `cursor` provider description, login, catalog projection, quota reader. It loads the SDK lazily and only for login.
3. **`external-harnesses` / `runner/hosted/`** — the shared hosted-runner kit, factored out of the Claude runner: the door to the server (`HostedDoor`), the handed-call relay (`Handed`), the ACP-agent side and process session, turn orchestration (hosted-turn opening, prompt and steer fates, cancel before send), neutral output into ACP updates (`tool_call` with `tagma/executes`, `_tagma/said`, prompt-answer spend with `tagma/cost` and `tagma/turn`, and refusal with `tagma/failure` in `error.data`), a text rendering of the journal for a new session. The vendor plugs its loop in with neutral types; no Claude or Cursor names, no branches on the vendor in the kit. Claude moves onto the kit in the same change ([[dd380bf6]], [[6f758080]]). → [[050e0330]]
4. **`external-harnesses` / `runner/cursor/` and `vendors/cursor/acp.ts`** — the loop adapter over `@cursor/sdk` (the only file touching SDK types), the hosted ACP profile, the `cursor` branch in `cli/harnessRun.ts`. The served provider declares the ACP profile, not the model's terminal surface: today `servedBy` (`contribution.ts:18–29`) takes the provider from `launch.model`, shared with the `cursor-agent` terminal argv, where SDK model ids must never go. → [[b81e55d7]]
5. **Delivery** — `@cursor/sdk` is sewn into the CLI bundle with a lazy import in the runner, as the Claude Agent SDK is; the platform `@cursor/sdk-<platform>-<arch>` package is carried conservatively until a live local turn proves the package is unneeded. → in the runner spec.

Data flows:

- **The operator's word:** inbox → ACP driver → `session/prompt` (a word mid-turn becomes the next prompt) → runner: `open_hosted_turn` (turn context and step guidance), `read_hosted_tools` → `agent.send(message, { model, local: { customTools } })`.
- **A tool call:** model → SDK → `customTools.execute(args, { toolCallId })` → runner → `call_hosted_tool` → the native tool door in the turn's world (law, approval, order, authorship) → back to the model.
- **Output:** SDK `onDelta` → loop adapter → kit-neutral events → `session/update`, `_tagma/said`, prompt answer with spend → the thread journal.
- **Catalog and quota:** `providers` → `adapter-cursor` → `GET` of the catalog and `GetCurrentPeriodUsage` on login/event timers; no turn waits for them.

## Work order

1. Implementation with no live key: the operator never logs in. Bun import, wrong-key refusal on the public API, and the hosted-runner path to the SDK with a test double under its tag are checked. Facts about a live local turn are never claimed proven; its separate task stays open after this spec closes.
2. Provider spec: contract and `providers`, then `adapter-cursor` — the Providers screen works before the runner.
3. Kit spec: factored out of the Claude runner, Claude contract tests pass.
4. Runner spec: the Cursor loop adapter, profile, landing, delivery, fork and rewind by journal.
5. The feature-catalog records update on fact: [[d7d24be1]] (boxed providers), [[44dc7c58]] (ACP threads), [[825673b8]] (model switch), [[f443c147]] (login from the window), [[39bbe00b]] (quota).

## Out of scope

- Cursor's own agent over the SDK instead of the terminal `harness:cursor` (its tools, `.cursor` rules, hooks as law). The terminal path stays; replacement is separate work, once a probe shows project hooks fire under the SDK.
- Cloud agents and the Cloud Agents API.
