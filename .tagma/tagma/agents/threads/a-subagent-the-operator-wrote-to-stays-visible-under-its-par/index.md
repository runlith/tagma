---
id: 01a1705d-6a90-7f7b-8501-59b8486c7d1b
title: "A subagent the operator wrote to stays visible under its parent: pin at any tree level"
ord: 74
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92977939353e
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/tree.ts
  - kind: file
    ref: apps/tagma/server/src/thread-record/shelf.ts
  - kind: file
    ref: apps/tagma/server/src/threads/turns/reader.ts
---
A finished subagent sinks into the "N finished" fold under its parent; with dozens of subagents under a parent, returning to the one the operator wrote to means opening the whole fold. Pin becomes a mark at any level: at a root — as now, the Pinned strip; at a subagent — it stands visible under its parent, above "N finished", even after it finished. Sketch with mockups — the "Subagents in view" page (artifact `3cea24d47f04`); the operator took the decisions on 2026-10-25.

## Decisions

- An operator word to a subagent — sending, queued words, steer — pins it on its own, with no setting. Answering its question or approval does not pin.
- Pinned finishers stand under the parent after running and waiting ones, directly above "N finished"; the counter does not count them. A running pinned one stands among the running.
- By hand: Pin and Unpin in the subagent row menu, in the same place as at a root; the pin in a pinned row clears the mark; dragging a subagent row onto the parent pins, onto "N finished" — unpins.

## Device

- The mark is the thread's own `pinned_at`. `setPinned` writes it to the thread, not to its live root; wire and database do not change: `pinnedAt` already rides every list row.
- Auto-pinning sets `ReaderMarking.spoke` — a step only the operator's words to a subagent pass through; answering a question goes through `wrote` and does not touch the mark.
- The takeover mark does not fit: it answers who questions go to, `/approver default` clears it, and with `agent.takeover` off it does not exist.
- Detach carries the mark with the thread into the root (Pinned strip), Return under keeps it.
- In the app `foldTeam` yields pinned finishers as a separate group standing after the "more working" fold and before "N finished"; the team aggregate counts pinned descendants, and a finished parent with a pinned descendant stands visible, as with an unseen failure.
- The list window holds a root with a pinned descendant as it holds a pinned or running root: the server rises to it from pinned subagents, the app does not release it while a mark stands under it.
- The mark is set by a separate `ReaderMarking.pin` step: its failure is logged and does not hinder takeover or the parent notification.
- A drag started on a subagent row carries it alone: targets are its parent and its "N finished". A tree into a folder or into Pinned moves by the root row.

## Acceptance

- The operator writes to a subagent; finished, it stands under the parent above "N finished", and the counter does not count it.
- Unpin in the menu or a pin click returns it to finished; the operator's next word pins again.
- Answering a subagent's approval or question does not pin it.
- A pinned grandchild keeps its finished parent visible.
- `pin_thread` on a subagent pins the subagent itself; the roots' Pinned strip does not change.
- Detaching a pinned subagent places it in Pinned; Return under leaves it pinned under the parent.
- A subagent row can be moved onto the parent — pinned — and onto "N finished" — unpinned; when all finishers are pinned, "0 finished" stands for the move's duration; dragging a root works as before.
- An old root that left the window by time stays in the list while a pinned subagent stands under it, and leaves after the last mark is cleared.
