---
id: 01a14b6d-b1ec-7242-8f1a-09646a671c80
title: "Operator steers a thread's turn: writes into the running turn, queues words, takes them back, stops, continues, and answers the agent's question"
ord: 7
---
The operator writes to the agent and steers its turn without waiting for its end: adds words into the running turn, queues the next assignment, takes it back, stops and continues what was cut, and answers the agent's question.

**In the composer.** Enter sends: an idle thread opens a turn, and in a running turn the word is read at the next step (hint "the running turn reads it at its next step", above the field — "Messages to be submitted after next tool call"). Tab or Cmd/Ctrl+Enter during a turn queues the word for the next turn. Esc during a turn stops it, and unread words leave at once. Pending words and the queue stand visible above the field and are removed from there. After a cut run the feed carries Continue. The agent's question (`ask_user` — a blocking question with choices, several questions, or a secret) is answered right in the feed.

**Operations** (operator only): `start_turn` — a turn from a message or a word into the running turn; `queue_turn` — behind the running turn; `steer_turn` — into the running turn; `unqueue_turn` — take back a pending turn, an unread steer, or a compaction request; `answer_question` — an answer to the question the run stands on, opens a run over the answer; `stop_run` — stop the turn or take back a word it took (`withdraw`); `continue_thread` — one new run over the history of a thread whose run was cut by a restart, stopped, or broken by a failure. Terminal: `tagma ask --thread`, `tagma steer`, `tagma stop`, `tagma continue`, `tagma answer`, `tagma unqueue`.

**Limits and refusals.** A transport that does not read words mid-turn answers steer with `not-steerable`, and the word stands behind the turn. `withdraw` needs a transport with history, otherwise `transport-cannot`. `continue_thread` refuses a thread whose last run finished the turn (`run-not-interrupted`), and a parallel start answers with the already running run. Stop lifts only the run's foreground work; background is lifted by its own Stop, archive, or deletion. Without alpha access, start refuses with `access-required`.

**Links.** The operator's words to a sub-agent; approval mode; turn rollback.

Code: apps/tagma/server/src/threads/contract/wire/operations/turns.ts#TURN_OPERATIONS, apps/tagma/server/src/threads/operations/turns.ts#TURN_PAIRS, apps/tagma/server/src/threads/contract/wire/operations/catalog.ts (continue_thread), packages/chat-ui/src/composerKeys.ts, apps/tagma/app/src/lib/features/threads/native/strings.ts, packages/agent/src/tools/UserQuestion.ts#threadUserQuestionTool, apps/tagma/server/src/threads/cli/turnVerbs.ts
