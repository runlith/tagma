---
id: 01a17321-2895-71ed-b498-9b28c290c271
title: The TUI's own commands over the conversation — /rewind, /fork, /branch, /clear, double Esc — reach the thread journal, and the thread never loses its CLI
ord: 1
tags: ["spec"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/observations/admission.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/observations/binding.ts
---
Goal: an operator who rolls back or forks a conversation with the CLI's own command right in the terminal surface gets the same thread as after a Tagma act. The journal and the CLI session never diverge, and the thread never loses sight of its CLI.

## What the CLIs do

Per the 2026-10-25 readings:

| CLI | Rollback in TUI | Fork in TUI |
|---|---|---|
| Claude Code | `/rewind` and double Esc: same session id, transcript is cut ([[27bbf5fb]]) | `/branch`: new id |
| Codex | backtrack: same thread id, new rollout ([[3260ddfc]]) | `/fork`: new id |
| Grok Build | `/rewind`: same id and `RewindMarker` in `updates.jsonl` ([[504dbcc7]]) | `/fork`: new id |
| Cursor | `/rewind`: same id, `latestRootBlobId` switches ([[b9c8b99d]]) | `/fork`: new id |
| Gemini CLI 0.37.1 | `/rewind`: same id, JSON is rewritten ([[5b5ca8a7]]) | — |
| OpenCode | `/undo`: same id, cut deferred until the next submit ([[9d725189]]) | `/fork`: new id |
| Devin | `/revert`: whether the id is kept is not established ([[6eeb5374]]) | `/fork`: new session |

`/clear` on Claude yields a new id with no closing hook ([[7fb55261]]): the new `session_id` is the only evidence. A `SessionStart` with `source: 'compact'` does not count as a new session.

## Now

The root once bound to a thread judges every later event. An event with a different root is `foreign` (`rootOf` in `observations/binding.ts`), and admission refuses it with `foreign-root`. Hence the conclusion a probe must still confirm: after a `/branch` or `/fork` in the TUI the thread stops seeing its CLI's turns. The journal never sees a rollback inside the TUI at all.

## Decision

- **The thread follows the root its own CLI execution works in.** A session start of the same execution with a new root rebinds `sessionKey`. A subagent root never counts. A whole fork does not cut the journal.
- **A rollback inside the TUI is reflected in the journal** as a core rewind act on the CLI's behalf, when the adapter sees it. Evidence differs per vendor:
  - Claude — the active chain no longer has the cut runs' prompts;
  - Codex — the rollout switched;
  - Gemini — rewritten JSON;
  - Grok — the marker;
  - Cursor — a new blob root.

  Where there is no evidence, the thread row names the limitation.
- The vendor turn map and the alignment from the parent spec are the shared foundation: a reflected rollback cuts rows just as a Tagma act does.

## Open

Each CLI's evidence is measured by a probe: that needs the operator's word. Which core act records a rollback "on the CLI's behalf" when runs have no stop is decided when the parent spec is built.
