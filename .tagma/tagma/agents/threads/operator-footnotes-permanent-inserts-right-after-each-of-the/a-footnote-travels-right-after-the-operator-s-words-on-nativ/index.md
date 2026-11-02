---
id: 01a140eb-0a34-75f6-93a0-7be91d74527f
title: "A footnote travels right after the operator's words: on native as a step-rules contribution, on ACP as a tail in the same driver message; compression does not retell it and does not count it as a turn"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/prompts.ts
  - kind: file
    ref: packages/agent/src/agent/turn/plan.ts
  - kind: file
    ref: packages/agent/src/thread/compaction/prefix.ts
  - kind: file
    ref: packages/agent/src/thread/compaction/prune.ts
  - kind: file
    ref: packages/agent/src/thread/compaction/segmentText.ts
---
The footnote goes to the model right after the operator's words, with one semantics on every road: each operator message gets the effective set once ([[f4702e26]]), recorded as a `runtime-guidance` event. Native delivers it with a step rule, ACP with the driver in the same message as the words.

## Operator words

Only reader words get the footnote: turn words with `readerInput` and reader-word signals (`isReaderWords`). Child reports, envelopes, tasks, and agent messages do not get it. An empty set means nothing.

## Native: a step-rules contribution

- The `operator-notes` rule is a `threads`-module contribution registered in the rules registry ([[bb429da3]]), not a hardcoded-list row in `composeAgent.ts:131-145`. Hook `beforeStep`, highest `priority` (the footnote guide goes last of the step's guides, after law and the rest), not critical: a failure is a `rule-failed` note on the run, the step goes without the footnote.
- The core gives the rule the `readerInputs` fact in `beforeStep` — the ids of the operator's words first served to the model in this step: on the run's first step the words that opened the turn, on any step the reader-word signals merged into the step (`plan.ts:85-86`). This is the step's delta: the rule does not walk history, and the step's price does not grow with turn length ([[2393aff1]]). A step retry (retry, overflow) takes the already assembled injection (`injected.current`) and does not double the guide.
- Position: guides go after the step's signals (`plan.ts:98-102`), i.e. after mid-turn words; on the first step after the turn's words and the turn context.
- Hosted ACP (the Claude runner) executes the same rules, but the driver brings the words there (below), so the hosted evaluation passes `readerInputs` empty and the rule stays silent in it.

## ACP: the footnote tail on the `prompt` channel

The operator's words leave for the vendor on ACP only through the driver — as the turn lead and steer ([[fb0b1868]]). The driver places the footnote, in the same message, as the last block:
- **Turn lead** (`protocol/prompts.ts:145-152`): today `[guidance…, words…]`; `RunGuidance.prompt` answers on top of this with the footnote tail, and the driver assembles `[guidance…, words…, footnotes]`.
- **Steer** (`_tagma/steer`, `_session/steering`): the driver appends the tail to the steer contents. A mid-turn word arrives with the footnote at once, not as a result of the next call.
- Recording is the same `runtime-guidance` event, via `RunGuidance`, in one plan with the send recording ([[2121a95f]]: delivered counts to bytes; an indefinite send is delivery).
- This way the footnote reaches any ACP agent, hosted or not: Devin has no hosting (`vendors/devin/acp.ts:8`), step rules do not execute on it.

## Cache

- A footnote is recorded in thread history (native) or in the message the vendor keeps (ACP). Old footnotes do not change: a set change takes effect from the nearest words and does not rewrite the prefix.
- The next run's history assembled from records matches the previous request's prefix: the "words → footnote" order survives saving.

## Compression and turn accounting

- **Retelling.** A guide carries the shared "do not retell" mark (`retell: false` in its frame state and message metadata), a directive sets it, and compression retelling (`segmentText.ts`) skips such messages. The core does not know the `operator-notes` rule id ([[e090f46d]]). After compression, footnotes arrive again with the next words.
- **Turns.** Compression and pruning windows count every `role: user` message as a turn (`prefix.ts:13-14`, `prune.ts:62-65`, in product `recentUserTurns = 2`). A guide after every operator message would turn "last two turns" into "words plus their footnote", and the previous exchange would lose protection. In the same work, a turn counts by its opening — a user message with no origin or an envelope, the same predicate as `opensTurn` in `media.ts:60-63`. This also stops counting orientation and other guides as turns.

## Visibility

- Thread search does not find them: it reads only spoken messages.
- The app shows them as an activity row only in verbose mode, like any `runtime-guidance` (`chat-ui/builtinKinds.ts:67`).

## How it is built (8be6045080c)

- **The rule contribution.** The [[bb429da3]] registry holds rules under capabilities, while every agent needs the footnote regardless of their set. So `threads` serves its step rules via the `AgentRules` service (`threads/contract/service/rules.ts`), and `composeAgent` adds them to its own without naming any.
- The **`readerInputs`** fact is assembled by `planStep`: on the run's first step the reader input from the history `user`-message tail, on any step the step's reader-word signals. The rule additionally skips ids already marked with an `operator-notes` frame in the message tail, so a step retry does not double the frame.
- **ACP.** `LaunchGuidance.prompt(thread, run, words)` answers the `tail`, `LaunchGuidance.notes(threadId, runId, words)` the steer footnote: text and a ready frame. The text comes from the `GuidanceSources.tail` port, filled by external-harnesses from `OperatorNotes`. The text resolves at send time, while the frame is stored in the protocol row — at the turn (`OpenedTurn.noted`) and at the steer (`Steering.noted`) — and written with the words, right after them: at the lead on Admitted, at the steer on `fate(read)`, at a turn of only unread words on reading its words. An unconfirmed or returned word writes no frame, as with its own words. A task with which the scheduler opens the turn (`begin`) comes from `host` and gets no footnote.
- **Turns** are counted by the shared `opensTurnMessage` predicate (`AgentSignal.ts`): a `user` message with no origin or an envelope.

## What shows it works

The performer proves it with tests on recorded `runtime-guidance` frames (ruleId, `retell`, word ids, history position), not prompt strings (the minimal-test rule):
- native: two operator messages — two frames, each after its own words; a set changed between them changes only the second; an empty set — none; mid-turn words — a frame in the same step; a step retry does not double the frame; a child report and a parent task get no frame;
- ACP: the turn lead and steer carry the footnote tail as the last block, the frame recorded once per send; the rule's hosted evaluation writes no frame;
- the next run's history from records matches the previous request's prefix;
- the compression prompt holds no `retell: false` messages; a pruning window with two operator messages and their footnotes keeps both exchanges.
