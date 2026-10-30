---
id: 01a17fa5-76d7-72ef-87aa-128c7d6de4a6
title: What hosted-opening has said stays the vendor session's debt until the vendor takes it, and leaves again with the next opening
ord: 10
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a16458-c462-7849-98a0-7c6114227879
  - kind: relates
    to: 01a17f7a-77f0-7df1-9ce3-3c3f6f57a121
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/hostedOperations.ts
  - kind: file
    ref: packages/hosted-runner/src/turn.ts
  - kind: symbol
    ref: packages/hosted-runner/src/cycle.ts
    symbol: Input
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/store/turns.ts
    symbol: VendorTurns
  - kind: symbol
    ref: packages/agent/src/thread/run/hostedParts.ts
    symbol: HostedOwing
---
What a hosted opening has said stays the vendor session's debt until the vendor takes it, and leaves again with the next opening.

The server records the turn context and the step guidance as said when the runner takes them through `open_hosted_turn`. But the model reads the vendor session, not the Tagma journal. The runner hands the opening to the vendor only after preparation (`session.prepare`: query reopen, waiting for `tools/list`), and the vendor may never take what was already sent. Treating said as delivered would leave working notes, a fork mark, graph changes, and law in the journal as said but never reaching the model when a cancel lands in that window, a door answer breaks off, the server restarts mid-opening, or the runner dies before sending. The next opening would only say what is new.

So what an opening has said is a debt in `vendor_session.owed` until the agent takes it. The debt is appended by the same transaction that writes the context message or guidance: a `ThreadHosting.open` commit member. Recording the debt after returning from the core would lose what was said if the opening breaks between the two writes. An opening answer carries the whole standing debt, oldest first.

The turn end whose prompt answer carries `_meta["tagma/opened"]: true` clears the debt — both a successful answer and a failed one. The kit sets the mark, but the session reports the "vendor took the opening" fact to it via the `Session` port's `Input.taken`, because a successful `start` does not prove it:
- Claude Code: the opener echo, a `command_lifecycle started` frame for its uuid, or the `result` of an uncancelled turn. An opener removed by a cancel before the start is not taken.
- OpenCode: after `session.prompt`. A cancel before it answers `cancelled`, having sent nothing.
- Cursor: after `agent.send`.

A new session from the journal also clears the debt (`VendorTurns.based`), because the journal already carries those messages. A full fork of the vendor session carries the child's source debt: the child inherits the world-state snapshot, but the copied vendor session does not carry what was said. Repeating an opening after a broken answer is safe, and `ServerDoor` repeats it like any other operation.

Where it is unclear whether the agent took the opening, it leaves again rather than being lost. That happens when the runner died after sending but before the prompt answer, or when a runner of another build never sets the mark. Cut and restore do not clear the debt: opening a cut turn may arrive extra along with the re-said words, but never vanishes.

Where the debt is lost: a fork with its point before the turn that carried the earlier turns' debt to the vendor. The child's session is cut to that turn, while what earlier turns said stands in the child's journal as known. Which debt which turn carried is not recorded.

The Tagma journal itself does not change: opening messages remain in their turns, and the world-state snapshot, graph cursor, and law count them as said. The vendor session catches up with the journal at the next opening. The words of a turn that did not reach the vendor are not resent this way: the kernel's turn closing decides their fate.
