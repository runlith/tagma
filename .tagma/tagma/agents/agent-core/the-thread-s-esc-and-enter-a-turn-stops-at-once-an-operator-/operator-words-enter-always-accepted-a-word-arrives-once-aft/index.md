---
id: 01a15eeb-6b48-7ca8-9c93-24da026af37c
title: "Operator words: Enter always accepted, a word arrives once, after a stop waiting words open one turn"
ord: 7
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: packages/agent/src/thread/run/scheduler
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRunInbox.ts
---
An operator word persists before any decision about it and reaches the agent exactly once, in press order. After a stop, all waiting words open one next turn.

## What stands

- **Steer without persistence.** `steer_turn` on `no-active-run`, `run-mismatch`, and `not-steerable` persists no words (`scheduler/inputs.ts:204-209`); not losing them is the caller's concern. `send` in the same race opens the turn itself (`inputs.ts:460`).
- **After `aborted`, words leave as two turns.** A turn opens with only steer from unread steer (`RunScheduler.ts:255-257`); follow-ups await its end.
- **A suppressed wake passes silently.** Causes are archive, `LaunchGate` after two launch failures, a live `inflight` at the `receipt` transport, `ThreadRunConflictError`; only the log keeps a trace (`RunScheduler.ts:250-283`). A settlement publication failure picks up the outbox bypass after 60 s.
- **The next turn awaits all settlement subscribers** (`ThreadSettlementSettlements.ts:44-47`).
- **A refusal not about the word loses the word.** On ACP a word the agent refused through no fault of its own (session reopening, turn end before echo) is marked `Unconfirmed` and never served again.
- **`enqueue` awaits the thread's journal lane** — a 1 min await ceiling — behind the turn's own transactions (`ThreadRunInbox.ts:251`).
- **The native loop does not read a word on the final turn.** A final turn of one text checks no unread words (`AgentTurn.ts:406-410`).

## What will stand

- **One door for operator words.** A word persists in the inbox as the first act. Then the scheduler decides: steer into the going turn if the transport reads words mid-turn, else a follow-up or a new turn. The client receives an answer stating where the word stands — never "not accepted, repeat".
- **After a stop — one turn.** All waiting words, steer and follow-up pressed over the turn, open one next turn in press order. The turn opens right after the end record and does not await settlement subscribers unrelated to the words.
- **Words that opened the stopped turn open no new turn.** Esc means "don't do this", so the agent does not restart what was stopped. Identically on all transports, after the native model:
  - if the agent has not read the words yet (prompt not admitted by the agent, model request not sent) and the stop takes the turn (`withdraw`), the words return to draft and leave the inbox;
  - if the stop does not take the turn, the words close with the turn — said in the stopped turn. No `delivered` at an `aborted` turn remains in the inbox, and the next turn does not take them as `earlier`;
  - if the agent could have read the words, they are delivered to that turn and are not served again.
- **A suppressed wake is visible.** Archive, gate, or conflict show in the thread snapshot as the reason the words wait.
- **`Unconfirmed` — only when the agent could have read the word.** An agent refusal not about the word returns the word to the queue.
- **The word record does not stand behind the turn's transactions.** The inbox writes with its own short record.
- **When a word is read mid-turn.** Native and ACP read it at the next agent turn boundary: native at every tool-call boundary and before the final answer. The terminal — per the CLI profile's declaration. The declaration is part of transport registration; the client draws from it when the word will leave.

## Acceptance

The parent spec's conformance set:
- Enter in every race — turn ends, turn starts, vendor session reopens, thread archived: the word delivered exactly once.
- After a stop, steer and follow-up leave as one turn in press order.
- A suppressed wake is visible in the snapshot.
