---
id: 01a17315-5de1-79e8-af35-62482b46ae16
title: "Orca: rolling back \"to a turn\" exists only in structured chat on Codex (`thread/revert` with `beforeTurnId`, proven by full history re-read); on Claude it is off, TUI panes have none — read in .external/orca @0df25b7"
ord: 3
tags: ["research"]
fields:
  {
    "source": {
      "name": "Orca",
      "ref": ".external/orca @0df25b7"
    }
  }
edges:
  - kind: relates
    to: 01a108ea-e245-71d3-a0b2-d34c30b86b6d
  - kind: relates
    to: 01a14b9f-6b94-75cf-989e-01375d27ec30
---
How Orca rolls a conversation back "to a turn": only in structured (native) chat on Codex, via `thread/revert` with `beforeTurnId`; on Claude rollback is declared unsupported in this commit, TUI panes have no rollback. Read in `.external/orca` @0df25b7ac9 (2026-10-11); the code was never run, the CLIs were never launched. Paths are from `src/`.

## Where rollback exists

- Declared: `rewind: true` only on Codex (`main/codex/codex-structured-agent-definition.ts`); Claude, ACP agents, and Pi — `rewind: false` (`main/claude/claude-structured-agent-definition.ts`, `main/acp/acp-structured-agent-definitions.ts` — "ACP has no stable rewind or goal method", `main/pi/rpc-agent-definition.ts`). On Claude the comment: "Orca's marker-based rewind proof can never pass on the real binary; rewind returns via a fork" — i.e. Claude rollback, when it returns, is designed as a fork, not a transcript truncation.
- Orca's "structured chat" is not TUI: Claude goes through the Claude Agent SDK (`query()` with `resume: <session id>`, `main/claude/claude-structured-launch-resolution.ts`), Codex through `codex app-server` over JSON-RPC (`main/codex/codex-app-server-*.ts`). The user starts a rollback in this chat: the "Rewind to here?" act on a user message (`renderer/src/components/native-chat/use-native-chat-rewind.ts`, `native-chat-rewind-eligibility.ts`). Confirmation text: "Discard this message and everything after it? The message returns to the composer so you can edit and resend it. File changes on disk are kept."
- Offering the act: a user message that opened a turn at depth 0 (not a subagent, not queued, not a command, goal, another agent's message, or a picture with no local file) — `nativeChatRowOffersRewind`; rolling back past the context-clear mark (`/clear`, "context floor") is forbidden. A TUI pane has no such act: `components/terminal-pane`, `shared/agent-hook*`, `shared/tui-agent*`, `main/agent-hooks` never contain the word rewind.

## How the point is addressed

- The client sends `itemId` (the journal row key) and `expectedEpoch` (`shared/agent-session-rewind.ts`, `AgentSessionRewindParams`) plus the mutation envelope with `clientOperationId`, `expectedRuntimeFence`, and a payload fingerprint.
- The row key (`shared/agent-session-journal-item-key.ts`) is per provider: Codex — `codex/<threadId>/<turnId>/<ordinal>`; Claude — `claude/<sessionId>/<uuid>`; `orca/<clientMessageId>` — a submit before the provider echo. For a sent-but-unacknowledged message the host translates the submit key into the provider key (`providerKeys` in `main/native-chat/agent-session-wire/structured-agent-session-rewind.ts`; test "resolves accepted codex user submissions to provider targets").
- For Codex the point is a **turn, not a message**: the host finds the boundary in the journal by `turnId` (and by `readAgentJournalTurn(item.body)?.turnId`) and keeps everything before it; Codex rolls back whole turns (comment in `native-chat-rewind-eligibility.ts`: "a steer would also discard its turn's opener"). A key from a foreign thread (`key.threadId !== head.nativeId`) or a foreign provider is `invalid-target`. The provider receives `beforeTurnId: key.turnId`.
- For Claude the host never takes the branch: `else { return rewindRefusal('invalid-target') }`; Claude's addressing in code is the transcript uuid/parentUuid graph (`main/claude/claude-transcript-branch-graph.ts`) plus the SDK flags `resume-session-at`, `resume-drops-turn`, which `claude-structured-launch-args.ts` includes in `OWNED_FLAGS` — user arguments carrying them are dropped.

## What Codex rewind does and how Orca proves it worked

`rewindCodexSession` (`main/codex/codex-structured-rewind.ts`):
1. Preflight (`preflightCodexRewind`): the session is alive and the fence matches; `historyMode` is not `legacy`; no active turns (`activeTurnIds`) and no pending submit (`dispatchPending`); `thread/read` (without turns) returned the same thread, `status.type === 'idle'`, not `legacy`.
2. Before touching the provider: full history reads `thread/turns/list` and `thread/items/list` to the end over cursors, verifying the target turn is **present** (`targetPresence: 'present'`); the expected element set is computed from the turn preceding the target; this is saved in the `prepared` record (`onPrepared`).
3. Repeated preflight (test "rechecks provider idleness after preflight hydration") and **one** `thread/revert { threadId, beforeTurnId }` call.
4. After: the answer must concern the same thread (`foreign-thread`), then both indexes are fully read again, with the target turn **absent** (else `target-retained`); the element set must match the expected one exactly (`proof-mismatch`). Both indexes are read because a revert answer may carry empty turns (test "uses native revert and reads both retained indexes despite empty response turns").
Limits: up to 100 pages per index, reads under a shared byte and record cap (`AGENT_SESSION_HISTORY_MAX_PAGE_BYTES`, `CODEX_RESTORE_MAX_OPERATIONS`) → `history-limit` **before** the provider mutation; a repeating cursor → the same refusal.

## Transcript files and the Orca journal

- Orca never rewrites the Codex transcript: the app-server itself truncates on `thread/revert`; Orca only verifies the result by reading. Working-folder file edits are never rolled back (the confirmation text).
- Orca's chat journal is replaced with a new "epoch": after a proven revert `recoverStructuredRewind` (`…/structured-rewind-recovery.ts`) calls `journal.replaceEpochItems('handle_forked', fence, replacement)`; after a `/clear` only the suffix past the clear mark is rewritten and the epoch/prefix kept (`journal.context.rewind`, test "rewrites only the suffix, retires its aliases, and keeps prefix bytes and epoch"). The client sees the new epoch: `awaiting` until the new conversation arrives, while `epoch` is unchanged, with a 120 s timeout (`NATIVE_CHAT_REWIND_RESET_TIMEOUT_MS`).
- Retained rows are reassembled, not taken from the provider answer: `mergeRetainedHostLifecycleRows` (`structured-rewind-retained-host-rows.ts`) returns rows the provider lacks (command cards, goals, subagent rows, agent-sender, opener turns) and keeps their "first seen" time (test "keeps when each kept message was first seen, not when the rewind re-read it").
- The deleted message returns to the composer (`returnMessageToComposer`) — on `outcome-unknown` too: "A rewind that may have run must never lose the message; a duplicate draft is harmless".

## Phases, idempotency, and "laziness"

- The session record's `rewind` record goes `prepared → provider-succeeded → completed | refused` (`AgentSessionRewindRecordSchema`); `prepared` also stores `retained` (up to 10,000 rows, a byte cap), `contextClearOperationId`/`contextClearSequence`, `hydrationVerified`. The record is written before the provider call.
- Retrying the operation with the same `clientOperationId` returns the previous outcome with no second provider call (`replay` in the mutation plan; tests "replays the original ordinary rewind after another rewind replaces its record", "replays a lost suffix acknowledgment without rewriting or repeating the provider effect").
- **Recovery never repeats a revert**: `recoverCodexRewind` only reads (comment: "Recovery observes provider state; it never repeats an ambiguous native mutation"). When the target is still in provider history and the record is `prepared`, the record becomes `refused: provider-refused`; when the provider acknowledged the revert but verification failed — `outcome-unknown`, and chat blocks submits and repeat rewinds (`rewind: { supported: false, reason: 'outcome-unknown' }` while in `prepared`/`provider-succeeded`, `structured-agent-session-options-read.ts`).
- Concurrency: the second of two concurrent rewinds is refused by epoch (`stale-epoch`, test "refuses the second of two concurrent rewinds by the epoch it targets"); a rollback during an active turn is `busy` before contacting the provider; "busy exactly while the chat shows a sent message unanswered".
- "Lazy" rollback: for a resting chat the provider starts for the rollback (`prepareSession: openWithAgent`, comment "Only the provider can do this, so an agent at rest is started first"; describe "a rewind asked of a chat at rest" in `structured-agent-session-rewind-at-rest.test.ts`, test "starts the agent first and answers with what the provider says"). An interrupted rollback of a resting chat or a live agent settles with the nearest submit or `/clear`, and the message after that is delivered (`structured-agent-session-rewind-at-rest.test.ts`, `…-live-send.test.ts`: "is settled by the next send, which is then delivered", "refuses the send while recovery stays unknown").
- Claude leftover: `settleUnsupportedClaudeRewind` closes a "hanging" `prepared`/`provider-succeeded` Claude rewind recorded by a previous build as `refused: unsupported`; chat attaches with `resume` by session id and no `resumeSessionAt` (`structured-claude-pending-rewind.test.ts`).

## What exists for Claude but never serves as rollback

- The transcript graph (`main/claude/claude-transcript-branch-graph.ts`) builds uuid→parentUuid nodes from JSONL, excluding sidechain, `parent_tool_use_id`, `result`, `stream_event`, and `system/init` as leaves; verifies cycles, lost ancestors, "parent before child" order, a 10,000 depth cap, and the `last-prompt` marker (sometimes lags the file after a crash, so history reads with `tip: 'file-tail'`). Relations `initial | same | descendant | intentional-rewind`; with `intentionalRewindUuid` the mark must match the previous leaf and be an **exact ancestor** of the previous cursor (test `claude-transcript-rewind-proof.test.ts`: a neighboring branch and sidechain are refused even with explicit intent).
- In production code these functions serve history-window reads (`main/claude/claude-structured-history-window.ts` imports `claude-transcript-branch-proof`); the main code has no rewind-mode call on the rollback path — it is off at the capabilities level.
- Claude's resume point is stored as `resumeCursor` in the provider handle (a leaf uuid), refreshes at the end of every finished turn, and stays on the last finished turn after a crash (`claude-structured-turn-resume-point.test.ts`); resume itself goes by session id — "Claude continues from the end of its own conversation" — with no `resumeSessionAt`.

## What the reading does not establish

- How Orca plans to bring Claude rollback back "via fork": code holds only the comment and the already placed refusal; Claude `--fork-session` is unused in chat.
- What Codex's `thread/revert` does on disk (rewrites the rollout, adds a marker, leaves the file): Orca never reads or verifies this.
- Claude/Codex TUI panes' behavior under their own `/rewind`/backtrack (Orca neither intercepts nor reflects them).
- Resilience to a CLI restart between `prepared` and the call: branches are covered by tests with a substituted provider; live Codex was never launched.
