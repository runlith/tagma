---
id: 01a15ba6-6aca-7c3d-990f-13471510fceb
title: "Words to an agent — one canonical form from any sender: operator and parent-agent write, task, and interrupt alike, and words never vanish"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a116de-c806-7b70-8440-4711fb0b1868
---
**Outcome.** Everything addressed to an agent stands in the feed in one form — a message bubble with a sender. That covers the operator's words, plus `send_message`, `send_task`, the birth task, and a child's report from an agent.
- The operator's words stand on the right without a signature, as now.
- An agent's words are the same bubble with the sender name: it links to its thread. The kind ("Task", "Report") is named in words when it is not just a message.
- Mechanics — end of command, keep-warm, guidance — stay as work steps.

Any sender's words live one life:
- **waiting** — in the dock above the input field, with the sender; steer and queue behave as the operator's do now;
- **read** — a bubble in the feed where the turn read it;
- **revoked** — with the operator it returns to the draft, with an agent it leaves the dock, and its tool answers the sender with a revocation;
- **unconfirmed** — the bubble stands in the feed marked with a reason.

Disappearance is not a word state. Escape with a waiting word on any transport interrupts the turn, and the word opens the next turn as a bubble, as on native.

**Why.**
- An agent's read word is drawn only in verbose. In `packages/chat-ui/src/builtinKinds.ts` a signal with a `transport` addressee without `unread` gets `verboseOnly`.
- The birth task is written as a user message with an `agent-birth` mark and drawn as the operator's bubble.
- On ACP a word Claude Code executed after Escape is not written at all ([[bcff25ca]]).
- Agents' waiting words already arrive in `pendingInput.arrived` and stand in the feed as an `unread` row, but not in the waiting dock.

**Owners and mechanics.**
- **Core** ([[d1caad35]]). Every read word is a journal entry with a sender and a kind. The operator's is a reader signal, an agent's a signal with `from` and `senderThreadId`; fate is already written by `RunReports.fate` ([[fb0b1868]]). A born agent's first words carry the parent sender and the "task" kind, not a bare user entry. A word that became `delivered` without confirmation is written into the turn marked "unconfirmed" and does not vanish from the journal.
- **ACP** ([[287a4906]]). The runner tells the driver which unrevoked word was taken, and the driver gives it a `read` fate — [[bcff25ca]].
- **Kit** ([[cb732496]]). One "words to agent" entry view draws reader and agent signals alike: sender, kind, state. Classify does not hide agents' read words. The waiting dock (`PendingInputDock`) shows `pendingInput.arrived` next to the operator's steers. The view is registered in the kit view registry ([[b7bb8a8f]]).
- **App.** Kind words and the sender-thread link come from product rows.
- **A plain child** gets the parent's words in the operator's voice ([[4bd3b0cd]]). That is a special case of the same form: such a bubble stands unsigned.

**Acceptance.**
1. A child got `send_message` and `send_task` from its parent. Its feed shows both as bubbles with the parent name — also after reading, without verbose. The command-end notification stays a work step.
2. The birth task is drawn as a "Task from <parent>" bubble, not as the operator's bubble.
3. While the turn has not read an agent's word, it is visible in the dock above the input field with the sender.
4. A word sent mid-turn after Escape stands as a bubble in the feed on native and on ACP. An unconfirmed word stands marked. On no transport does a word vanish without a trace.
5. Native and ACP pass one word corpus: system test (`protocolWords.stest.ts`) and kit test.
