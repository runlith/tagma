---
id: 01a10482-12cc-776a-a675-6349c478e2d3
title: "Agent collaboration as server operations: a foreign CLI thread sends messages, tasks and the final answer over MCP"
ord: 10
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/cli/mcpTools.ts
  - kind: file
    ref: apps/tagma/server/src/threads/library/types.ts
  - kind: file
    ref: packages/agent/src/collaboration/CollaborationTools.ts
---
## What the operator gets

Claude Code, Codex and other CLIs launched as Tagma threads work in the agent team on par with Tagma's own agent. They write to any thread mid-run, hand out tasks, spawn children, interrupt, see the agent list, and answer the parent with a final answer that closes its request. Now they have only the automatic end-of-run report.

## What stands now (measured 2026-10-04)

- A foreign CLI's MCP bridge (`cli/verbs/mcpServe.ts`, `cli/mcpTools.ts`) serves only server operations with the `mcp` door.
- Collaboration verbs are runtime tools (`packages/agent/src/collaboration/CollaborationTools.ts`). Only the native agent receives them, via the `peers` capability (`native-harness/capabilities/peers.ts`).
- `threads/library/types.ts` records `EXTERNAL_CAPABILITIES.messaging: false`.
- Live-server check: a Claude Code thread (`harness:claude`, Sonnet 5.5) found no `send_message` among Tagma tools. It could answer its parent only with the run's end. Its own `SendMessage` does not reach Tagma threads.
- [[09fbed62|Final-answer spec]] promised `final` "at every door that carries the collaboration catalog: native, and Tagma's MCP", and that a CLI sending `final` closes the request like a native agent. The current MCP does not carry this.

## Target model

1. **Owner — the threads module.**
   - It declares `send_message`, `send_task`, `interrupt_agent`, `spawn_agent`, `list_agents`, `stop_agent` and `continue_agent` operations with `mcp`, `http` and `cli` doors.
   - They share the performer with runtime tools: `ThreadPlaneAccess`, which builds `ThreadSpawnTree.access(thread, run)` for the calling thread. There is no second implementation.
   - The `agent` door of these operations is closed: the native agent keeps its runtime tools under the same names, and it never gets two tools with one name.
2. **Sender — the calling thread.**
   - Invocation restores the thread from the signed grant Tagma hands to the CLI it launched (`external-harnesses/sessions/launch.ts`, `platform/credentials/grants.ts`, `invocation/admission/identity.ts`).
   - A call with no thread refuses `no-calling-thread` with an unblock. This is an operator call from a terminal or a CLI without a grant.
   - The MCP-declaration key is shared across installs and does not count as thread identity.
3. **Semantics match the runtime tools to the letter.**
   - Inputs, answers and refusals match: `no-open-request`, unknown address, `final` together with `inReplyTo`.
   - Obligations and their settlement, depth rules and the delegation switch at spawn, permission subjects all match.
   - Descriptions and input schemas come from the `@runlith/agent` package, where the runtime tools keep them, instead of being rewritten in the server.
4. **Idempotence.** The idempotence key is the call's key carried by the door:
   - on HTTP it is the `tagma-call` header;
   - `tagma op` takes it from `--call` or mints one per process call;
   - the MCP bridge takes `_meta["tagma/call"]`, then the tool-call id sent by the CLI itself (Claude Code — `_meta["claudecode/toolUseId"]`), otherwise the "bridge instance + JSON-RPC request id" pair.

   Retrying the same call answers with the first receipt: no second envelope and no second child. The same key with a different addressee or different words refuses `key-reused`. Retrying a final answer never picks up a different, newer request. A new model call, even with the same words, is a new key and acts anew. A call with no key gets a fresh key and stands on its own.
5. **Capability.** `EXTERNAL_CAPABILITIES.messaging` becomes `true`. Before that, the builder reads every place that reads it and verifies the flag means "the thread uses the collaboration verbs".
6. **Words for the CLI.** The skill and law Tagma installs into the CLI (`external-harnesses/installs/*`) say three things:
   - Tagma threads are addressed with these Tagma operations;
   - the final answer to the parent is `send_message` with `final: true`;
   - the CLI's own `SendMessage` and Task do not reach Tagma threads.

## Outside this work

- How words are delivered inside an idle CLI.
- The CLI's own subagents in the Tagma tree — [[5fbec5dd]].
- Compaction, model change, fork and rewind of the CLI thread itself: they stay closed in `EXTERNAL_CAPABILITIES`.

## Rejected

- **A separate "call the thread's runtime tool" door.** A runtime tool is designed for a native agent's run: `toolCallId`, `step`, `settleEffect`. A CLI has no such run, and an operation is the single surface with one name on all doors.
- **`speak_harness` for CLIs.** Those are a reader's words, with no sender thread and no obligations.

## Check

1. Integration, harness thread with grant:
   - a `send_message` operation delivers the addressee an envelope whose `from` is the CLI thread;
   - `send_task` opens an obligation;
   - `send_message` with `final: true` closes it, the parent receives exactly one report, and no automatic run-end report is sent on the closed request.
2. A call with no thread refuses `no-calling-thread`.
3. `spawn_agent` from a CLI thread honours depth and the delegation switch like a native one.
4. Retrying a call under the same key creates no second envelope and no second child.
5. The `mcp-serve` catalog lists the new operations.
6. After the operator restarts the server: a Claude Code thread sends its parent a message mid-run, then a final answer.
