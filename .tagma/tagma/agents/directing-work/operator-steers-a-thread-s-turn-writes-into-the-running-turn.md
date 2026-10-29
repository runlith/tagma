---
id: 01a14bae-6720-7d62-897a-927c37d1b13b
title: "Operator steers a thread's turn: writes into the running turn, queues words, takes them back, stops, and continues"
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927dd673fb57
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927fda029bcc
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92846c655f6f
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9294da5d3d19
  - kind: relates
    to: 01a14be4-2437-75af-92bd-b426479aedfc
  - kind: supersedes
    to: 01a14b6d-b1ec-7242-8f1a-09646a671c80
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/strings.ts
  - kind: file
    ref: apps/tagma/server/src/threads/cli/turnVerbs.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/operations/catalog.ts
  - kind: file
    ref: packages/chat-ui/src/composerKeys.ts
  - kind: file
    ref: packages/chat-ui/src/PendingInputDock.svelte
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/operations/turns.ts
    symbol: TURN_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/threads/operations/turns.ts
    symbol: TURN_PAIRS
---
**Value.** The operator corrects the agent mid-run instead of waiting for the turn to end or starting over: a word lands in the running turn or queues up.

**How.** Thread composer; operations `start_turn`, `steer_turn`, `queue_turn`, `unqueue_turn`, `stop_run`, `continue_thread`; CLI `tagma ask`, `steer`, `stop`, `continue`, `unqueue`.

**Behaviour.** The agent reads a word sent into the running turn at its next step. While the turn runs, the empty field names the keys (↵ — into the next step, ⇥ — after the turn), and the send button stays put for the whole turn; where the transport reads words mid-turn, its menu offers both paths by mouse too. Pending words stand in a tray past the input field in three groups: the operator's own words for the next step, their own after the turn, and unread words from other agents, collapsed into one line with sender names; that line names server messages about children and background calls in event words ("4 agents finished") with child names, as the feed does in verbose mode. Their own word can be removed before it is read, taken back into the field with its attachments (⌥↑ — the last one) or, where the transport reads words mid-turn, promoted from the queue into the next step; images of a pending word show as thumbnails. A word the turn already took can be withdrawn. A read word stands in the feed where the turn read it; a word the agent could have taken but did not confirm stands marked. A word enters the "next step" the instant Enter is pressed; it leaves for the server after the responses to this thread's model, mode, delegation, and command writes made before the press — a refused write of that kind does not hold the send, and writes of other threads do not wait for it. Esc stops the turn with any focus in the thread — in the feed, on a pending word, on the Stop button — and with a reconnected feed; first it closes an open menu, panel, or rewind picker. From the press until the turn ends the thread shows "Stopping…" (another server process owns the turn — "Being stopped"), and a repeated Esc sends nothing; if there is no running turn, the thread says so. A turn where the agent has done nothing yet is taken back by the server, and its words return to the field. Stopping removes only the run's foreground work and hands over unread words at once. A run cut by a restart, a stop, or a failure continues as one new run over the history.

**Limits.** A transport that does not read words mid-turn (terminal CLI, Devin) puts the word after the turn. A taken word can be withdrawn only on a transport with history. Background work is stopped separately.
