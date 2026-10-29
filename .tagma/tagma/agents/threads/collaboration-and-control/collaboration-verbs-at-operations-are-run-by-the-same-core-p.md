---
id: 01a104a8-2592-7eeb-a4d9-ce396009977c
title: Collaboration verbs at operations are run by the same core plane as runtime tools, and the core itself declares the refusal codes
ord: 2
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a10482-8175-77c1-9919-b23539d67a59
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/operations/collaboration.ts
  - kind: file
    ref: packages/agent/src/collaboration/collaborationVerbs.ts
  - kind: file
    ref: packages/agent/src/collaboration/refusals.ts
---
A CLI thread has no native run (`toolCallId`, `step`, `settleEffect`). So the `send_message`, `send_task`, `interrupt_agent`, `spawn_agent`, `list_agents`, `stop_agent` and `continue_agent` operations do not call a runtime tool. Instead they take `ThreadVerbs` via `AgentHarness.collaborate` for the grant's thread, with no run.

`ThreadVerbs` is the part of `ThreadPlaneAccess` these verbs need. It builds with no reading of depth, the type catalog, or worktree policy; native `access` unfolds it into itself. Input schemas, descriptions and answer shape live in `collaborationVerbs.ts` and `agentRoster.ts`, and both doors read them. The operations' `agent` door is closed so the native agent never has two tools under one name. Operation text is static, so it describes outcomes true on any host, while host narrowing stays with the native tool.

**Refusal codes.** The core refuses via `planeRefused(code, reason)`. Codes and their unblock are declared in `refusals.ts`, together with per-verb code groups. Operations declare `refusals` from those groups, so renaming a core code breaks the typecheck and cannot silently corrupt the answer. `planeRefusalOf` maps typed core failures to a code:
- `PlaneRefused`;
- `AgentProfileUnknownError` → `unknown-type`;
- `BirthConflict` → `name-taken` or `spawn-conflict`;
- key retry → `key-reused`.

The native tool preserves the same refusal's `code`, `reason` and `unblock` via `hostCall`; `Tool.make` declares its family's codes. `ThreadRunConflict` yields `thread-running` or `key-reused`, and an ended run at `continue_agent` — `not-interrupted`.

How an operation answers a refusal:
- a code declared on the operation — `GateRefusal` with that code;
- an undeclared code — `collaboration-refused` with `code: reason` and the owner's unblock;
- a codeless failure — `collaboration-refused` with the whole phrase;
- a storage failure — a defect, not a refusal.

**Archived recipient.** A fresh send of a message, task, interrupt, or task with `compact` to a thread the host's `ThreadResting` port calls resting refuses `thread-archived` before the envelope is written: otherwise an archived thread would silently store words unread, and the sender would receive `stored` with `runId: null` and believe work is going. A retry under the same key answers with the prior receipt, while a final answer to the parent and the core's passive delivery still land in the inbox. The check stands before the envelope transaction and does not share it with archiving: a send racing archiving is ordered before it and lands in the inbox as `stored`.

**Worktree.** Subject `worktree:new` is issued by one `worktreeSubjects` function for both doors: only on `worktree: new` and `agent.worktrees = ask`.
- The native door passes `worktreeAsked` because the call went through its permission kernel.
- The operation takes the policy in `prepare` and passes `worktreeAsked` when the subject exists: a CLI-thread call already passed the CLI's own permissions, and the door holds no second trial. A placement refusal reaches the operation typed (`PlacementRefused`).

**Idempotence key** — the call key (`SignedCall`):
- on HTTP — the `tagma-call` header;
- on `tagma op` — `--call` or a key minted once per call;
- on the MCP bridge — `_meta["tagma/call"]`, then the tool-call id sent by the CLI itself (the adapter's `mcpCallMeta`, for Claude Code `claudecode/toolUseId`), otherwise the "bridge instance, JSON-RPC id" JSON pair with the stored id type.

How the key acts:
- every send — message, task, interrupt, final answer, and task with `compact` — records the call key as one keyed act `send:<sender>:<key>` with a digest of the whole meaning: `to` addresses in the call's order and spelling, intent, `final`, text, `inReplyTo` or `keep`; the same key with a different meaning on any road refuses `key-reused`;
- for a message, a task without `compact` and an interrupt the same act accepts all recipients' envelopes and wake intents in one transaction ([[5add92f2]]), so a retry under the key answers with the same envelopes, delivered to the threads where they stand, with no fresh address resolution;
- both inbox adapters honour a keyed act with `call` evidence: SQLite (`ThreadInboxStore.control` writes and reads `thread_call`) and memory (`InMemoryInboxStorage` writes into the shared transition record registry);
- the final answer is recorded under the same key, and its retry answers with the first request, never taking a newer one;
- without a run, CLI-thread children are born with no `bornOf` and no `spawnedByRunId`.
