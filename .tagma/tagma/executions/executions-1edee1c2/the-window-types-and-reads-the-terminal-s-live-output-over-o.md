---
id: 01a17b8e-8d92-7b58-abcd-71dfbd144e0d
title: "The window types and reads the terminal's live output over one lane connection: the seam with record history stands on the cursor, a break reconnects with the same secret, and a lost lane reopens through the server"
ord: 16
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a17b24-b0a8-7e8a-9091-24f6303715ed
  - kind: relates
    to: 01a17b47-31a7-75a4-8338-e09319621016
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Input.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/LaneConnection.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Output.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/RecordStream.svelte.ts
---
The endpoint contract is [[303715ed]]; here is what the window holds.

**The history/live-output seam.** `RecordStream` reads record history through the server up to its durable frontier and then sends `follow` from the cursor into the lane connection. The cursor moves only together with bytes handed to the writer, so switching sources — record read, server subscription, lane — lands on the cursor with no holes or repeats: a frame is checked against the cursor by offset, overlap is trimmed. A frame ahead of the cursor, up to the first frame that converges with it, is a leftover of the connection's old position sent before the new `follow`, and the window skips it; after convergence a frame ahead means a hole, and the window re-reads the record from the cursor, as on `behind`. The record lags the pump by less than the stream tail holds ([[19621016]]), so `follow` from the end of the re-read record converges. Switching from the server subscription to the lane starts a new generation: the subscription delivery awaiting note parsing is dropped whole and never touches the cursor. An execution end that learned about input (`verify`) also starts a new generation: the in-flight record read is dropped before the writer, and the record is re-read from the cursor in one read — otherwise two reads from one cursor would print the same bytes twice; a read with nothing shown yet still lands on the tail. The end is reported only after the re-read record: a lost re-read keeps the stream in `Recovering` and repeats with a growing pause instead of handing the outcome over an undisplayed history. Every record chunk reaches the writer with its first byte's offset (`next` minus length, including after a break), and the writer uses it to decide whether the bytes continue the stream: an unparsed UTF-8 or control-sequence tail is reset only where the offset jumped, not at replay start. The same offset in another stream means no continuity, so a source change — a new `RecordStream` on the same writer, a restarted record, a record stdout→stderr switch with no `output` — `RecordStream` names to the writer explicitly (`begin`). Window notes travel with no offset and parse apart from the stream, so a tail started before a note is completed by the bytes following it. While no lane stands — unopened, reconnecting, closed — and after `ended`, output goes by server subscription: only it delivers the execution end and its outcome.

**The same secret or a new lane.** A connection that stood (`ready`) and broke — codeless, 4408, 4409 — reconnects with the same secret and resends every unacked sequence in order: the host answers the same sequence with the same receipt, so a keypress is neither lost nor repeated. The first reconnect is immediate, later ones with a growing pause while connections die receiving neither receipt nor frame. 4410, 4401 and a connection closed before `ready` mean the lane is gone at that address: the address is the host logic process's ephemeral port; after a logic change or host restart the old one doesn't answer, and only the server knows the new one. Then the lane opens through the server, which always gives the view a new binding. An unanswered act may have been admitted, and a retry on another binding would print it twice, so it is dropped as lost together with everything typed after it, in one message: a tail without its head is never printed. Only when every sent act is answered does a new lane carry what isn't admitted yet — unsent and backpressure-refused acts without retry. Resending makes the act's fate unknown again.

**The lane stands while the shell is printable.** `Input` opens a lane when it attaches to a printable shell, so echo and output bypass the server from the first keypress, and holds it by lease — the `terminal.lane.hold` feed. Detaching closes the socket and drops the lease; reattaching within the server grace connects with the same secret.

**Grid from frames while following the lane.** Record grids arrive only with reads and the server subscription; lane frames carry bare bytes. So while output goes over the lane, the grid is laid by `applied` from `terminal.grid.subscribe` frames, the same path as record grids, and the last `applied` is laid at the moment of switching to the lane; while output goes by server subscription, the grid comes from byte-exact record grids.

**One paste chunk at a time.** The backpressure answer repeats every unacked act starting from the refused one, so a paste chunk goes only when no act is unacked: a window of many large chunks would cycle them through the host's interactive stream.
