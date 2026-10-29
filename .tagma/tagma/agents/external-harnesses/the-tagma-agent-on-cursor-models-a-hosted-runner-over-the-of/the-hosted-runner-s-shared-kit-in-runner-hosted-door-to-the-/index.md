---
id: 01a16434-fc60-7079-91d8-189d050e0330
title: "The hosted runner's shared kit in `runner/hosted/`: door to the server, call relay, ACP-agent side, turn, and neutral output factored out of the Claude runner, Claude moved onto it"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a10973-ef85-739e-8a04-c139d0810682
sources:
  - kind: dir
    ref: apps/tagma/server/src/external-harnesses/runner/claude-code
---
One hosted-runner mechanism — a process that runs the Tagma agent inside someone else's agent loop — for all vendors: today it lives whole in `runner/claude-code/`, mixed with Claude Agent SDK shapes. Before the second runner (Cursor), the shared part moves to `external-harnesses/runner/hosted/`, and Claude moves onto it in the same change ([[dd380bf6]]): no second copy of the door, call accounting, and word fates appears.

Claude's thread behaviour does not change in anything; this work shows only as code.

## What belongs to the kit

Per the hosting-seam researcher's file review of `runner/claude-code/` (2026-10-22):

- **The door to the server.** `HostedDoor`/`ServerDoor` (`door.ts`) move as is: five hosting operations, their retries (`answered-again` for reads and `call_hosted_tool`, `unsent-only` for `open_hosted_turn`), waiting for `run-not-held` on restart, refusals with `data`.
- **The call relay.** From `bridge.ts` and `handed.ts`: a Tagma tool call on the vendor's real call id → `call_hosted_tool`; a `Handed` mark before the call; a server refusal lifts the mark, a failure and an unreadable answer keep it; `offered` is the adapter's signal to serve the catalog again before the model's next request. How the vendor learns a new list (`tools/list_changed` in Claude, something else in Cursor) is the adapter's business.
- **The ACP-agent side and process session.** `serve` from `@runlith/acp/agent` is already shared; the kit takes one open session per process, a `sessionId` check, extension-params parsing, `initialize` with adapter-declared capabilities (`tagma/extensions` — only what the adapter implemented), `session/new|load|resume|close`, `set_config_option`, `set_mode` with one mode.
- **The turn.** Opening the hosting turn before send (`open_hosted_turn` → context and guidance as the first block; `read_hosted_tools` → the step's catalog), prompt and its wait, cancel before the first send (the prompt answers `cancelled`, nothing handed to the vendor), words arriving before the first send queued in the turn, the injected steer outcome in the driver dictionary (`injected` | `startedNewTurn` | `promptRequired`, refusal `-32800`), the prompt answer `stopReason` + spend + `tagma/cost` + `tagma/turn`.
- **Neutral output.** ACP updates from neutral events: text and reasoning, `tool_call`/`tool_call_update` with `_meta['tagma/executes']` (true for a call handed to Tagma, explicit false for one the vendor dropped before the relay — by `Handed`), the message boundary `_tagma/said` after all `tool_call` of the message, `usage_update` with `tagma/measured` where the adapter gave it, `$/tagma/phase`, `$/tagma/input`, `_tagma/retrying`, `_tagma/quota`, `_tagma/compacted`, a failure with `tagma/failure`. Compression the vendor did itself is an event with a retelling and optional before/after sizes: today `_tagma/compacted` requires `preTokens` and silently drops a notice without it (`protocol/methods/compact.ts:22–27,123–129`); the wire and the boundary record accept an unknown size as unknown, not zero.
- **The journal for a new session.** Neutral seeding of a new session from `read_hosted_history` — messages with text and pictures in their places, not one line: today's `recapOf` (`transcript.ts:32–33,103–113`) replaces a picture with a `[image/png]` line, though the history carries its bytes (`hostedHistory.ts:43–48,65–76`). The vendor adapter passes the seed its own way (Cursor — SDK message `images`, Claude — the session file, with text only where the file was never read). Claude Code's session-file build stays with Claude.
- **The process port.** stderr, session death → runner exit with an error (`run.ts`, `runner.ts`): the driver sees the process die and raises the session again.

## The loop port

The vendor plugs in with one port of neutral types — no `Options`, no `SDKMessage`, no Cursor types in the kit. The port answers: open a session (a new one with the journal or its text, continue one by id, else `notFound`), start a turn (message blocks, the run prompt, turn context, tool catalog, the Tagma turn id) with a stream of neutral events and an outcome, steer a running turn, cancel, settings (`model`, `effort`, switches) and their list for `configOptions`, close, death. Optional capabilities — `withdraw`, `compact`, `fork`, `rewind`, the vendor's question about its own tool (Claude's `WebFetch`) — the adapter declares; the kit routes only what is declared; the undeclared never enters `tagma/extensions`, and the driver never calls it.

The kit hands the run prompt to the adapter as a value; how to deliver it to the vendor is the adapter's decision: Claude — `systemPrompt` with query reopen on prompt change; Cursor — a message block. Same for the tool catalog and history.

## What stays with Claude

`sdk.ts` and `channel.ts` (the only place of `Query` and frames outside SDK types), `lifecycle.ts` (query, reopen on prompt and aliases, generations), steer echo by uuid and word merge, `command_lifecycle`, `interrupt({ cancelQueued })`, compaction via `/compact` and hooks, side question, fork and rewind by transcript, `WebFetch` with a hook, `mcp__tagma__*` names and aliases, `Meter` and `Spend` with Claude corrections, the `failure.ts` table, `transcript.ts` (the session file), `title.ts`, `version.ts`. Their behaviour is described in [[d0810682]] and stays exact after the move; the explanation is corrected by the same change wherever paths move.

## Module boundaries

The kit is a `runner/hosted/` field in the [[287a4906]] card (`set_module`, `order`) below the vendor runners: the kit never imports `runner/claude-code` or `runner/cursor`, and runners never import each other. The driver↔runner wire dictionary (`_tagma/*`, `Measured`, `Said`, `Retrying` schemas, now `protocol/extensions.ts`) moves to `contract/wire/`, so both the driver and the kit take it from below, never the kit from `protocol/`. Nothing opens out of the module kit.

## Acceptance criteria

1. `runner/claude-code/contract.test.ts` (Claude session behaviour on fake SDK and `Channel`) and `protocolWords.stest.ts`, `protocolMethods.stest.ts` pass; test edits are only paths and double builds, never expectations.
2. `runner/hosted/` has no import of `@anthropic-ai/claude-agent-sdk`, `@cursor/sdk`, or `runner/<vendor>/` files; the module card's `order` holds the check, not an agreement.
3. `door.ts`, `handed.ts`, the relay, and the journal's text rendering exist in one copy.
4. A live Claude thread over ACP (a Tagma agent thread on the `claude-code` provider model): turns with tool calls, an approval question in review mode, steer mid-turn, cancel, a server restart mid-call — as before the move.
