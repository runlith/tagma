---
id: 01a14b6d-b207-7c48-91ab-0627377b233c
title: The operator and the parent remove turns from a thread's history and bring back the rewound
ord: 15
---
A bad turn can be taken out of what the model sees and brought back on second thought: the thread goes on as if those turns never happened, while the feed remembers them.

**How.** Operator: "Rewind here" on a message — remove that turn and all after it, returning the message's words to the composer for editing; "Drop turn" — remove only that turn; Esc twice in an empty composer opens the rewind picker, up arrow edits the last message. Operations `rewind_thread` (`from` or `turn`; `revertLines` after a rewind returns the lines the thread wrote itself and never committed in those turns, except ones others overwrote or committed), `restore_thread`, `read_rewind` (what a rewind removes and does not bring back: turns, composer words, queue, live children, the rewritten prompt's cost, changed files and graph entries), `read_rewind_points` (which turns can still be removed and why not the rest, which rewinds can be returned). Parent: `rewind_agent` over a descendant.

**Behaviour.** The running run stops first; queue and unread words return as text in the answer, nothing starts on its own. Rewound entries stay in the feed with a mark. Files and graph entries are untouched by the rewind (except the operator's `revertLines`).

**Limits and refusals.** A rewind can be returned while no turn has passed since it and compaction has not finished (`restore-superseded`). A turn inside a summary is `rewind-summarized`. A transport with no history is `transport-cannot`; on an ACP session the vendor does the rewind itself (`session-rewind-failed` on failure). `rewind_agent` outside the subtree needs the operator's consent (`not-a-descendant`).

Code: apps/tagma/server/src/threads/contract/wire/operations/turns.ts#TURN_OPERATIONS, apps/tagma/server/src/threads/operations/turns.ts#TURN_PAIRS, packages/agent/src/collaboration/historyTools.ts#historyTools, packages/agent/src/thread/rewind.ts, apps/tagma/app/src/lib/features/threads/native/strings.ts#rewindWords, packages/chat-ui/src/composerKeys.ts
