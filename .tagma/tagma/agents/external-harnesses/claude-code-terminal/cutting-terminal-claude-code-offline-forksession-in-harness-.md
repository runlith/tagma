---
id: 01a17347-63c8-7985-b8af-29b0f3d47a3e
title: Cutting terminal Claude Code — offline `forkSession` in `harness-run claude-code --cut`; the run address and the copy's turns are read along the active `parentUuid` chain
ord: 11
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a17321-2895-71ed-b498-9b2d68c13219
  - kind: relates
    to: 01a17321-2895-71ed-b498-9b2711b4f93a
  - kind: relates
    to: 01a1732c-8663-7eed-af66-fea9880f739d
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/runner/claude-code/cut.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/vendors/claude-code/chain.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/vendors/claude-code/cut.ts
---
Both cuts of terminal Claude Code — whole and up to a turn — are prepared by `tagma harness-run claude-code --cut` on the execution target: the SDK loads only in the runner process, the session file lies where the CLI runs, and `forkSession` writes the new root Y file before the TUI launch, so a child closed before the first word does not lose its root ([[880f739d]]).

- **Conversation.** `fork {root, address, dir}` calls `forkSession(root, {dir, upToMessageId: address})`; a whole fork has no `upToMessageId`. The boundary is inclusive, so the address is the record the copy ends with. The server finds the Y file path in `<CLAUDE_CONFIG_DIR>/projects/*/<Y>.jsonl` rather than encoding cwd itself: the SDK puts Y in the X directory, and Claude's long-path encoding is its own. `turns {root}` answers with the Y turn addresses in order, null for a turn with nothing before it.
- **Active chain.** Selected the same way as in SDK 0.3.292 (`getSessionMessages`): from main-branch records with no descendants in the main branch, the last by file position is taken, from which user or assistant is reachable via `parentUuid`. Side chains, agent-command records (`teamName`), `progress` and `fork_briefing` do not enter the branch. Physical row order is not the chain: a row appended outside it does not move the address.
- **Run address** — the last record of the active chain before the run's first prompt, read from the transcript tail when the run starts. A cut first row of the window is skipped, a chain running past the window start is accepted. If the run's prompt already stands in the window (its `promptId` equals the hook's `prompt_id` and no assistant follows it), the address is its parent. A prompt with no answer at the window end that cannot be attributed to this run or another (the hook has no `prompt_id` or the record has no `promptId`) gives no address: the cut is inclusive and would otherwise leave the run's own words in the copy.
- **Y turns.** A prompt is a chain user record without `isMeta`, `isCompactSummary` or `tool_result`; a new turn starts with a `promptId` change, so a word embedded into the running turn under the same `promptId` adds no turn. The SDK rewrites uuids, and X rows are not copied into Y: pairs with X runs keep the order, and on count mismatch the runtime writes Y rows without addresses. On fixtures, each Y address's `forkedFrom.messageUuid` is exactly the corresponding X run's address.
- **Root check.** The `claude` fold in metadata marks `bound` on the record with Y's `sessionId` and refuses another session's file, so `verifyPreparedRoot` confirms Y on every fresh launch. It has not three pages like Codex: an SDK copy does not start with a small header, its first record is a prompt, which with a picture exceeds the record limit and is skipped; reading goes to the first record the fold read, or to the end of the file.
- **Compaction.** Turns before `compact_boundary` lie outside the active chain, so a compressed copy has fewer turns than X runs, and the runtime writes its rows without addresses. The saved-message rehanging (`compactMetadata`) that the SDK does is not repeated here: it changes nothing when compared in order.

Not measured: side chains inside the main file, a mid-turn word that Claude records as a separate prompt.
