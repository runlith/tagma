---
id: 01a17b47-31a7-75a4-8338-e09319621016
title: A terminal endpoint's live output runs on pty write offsets, and its lane lives exactly as long as the binding
ord: 8
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a17aff-0013-783e-93b0-8215dc3c916a
  - kind: relates
    to: 01a17b24-b0a8-7e8a-9091-24f6303715ed
sources:
  - kind: file
    ref: packages/execution-host/src/LaneInputs.ts
  - kind: file
    ref: packages/execution-host/src/posix/lanes.ts
  - kind: file
    ref: packages/execution-host/src/TerminalInputs.ts
---
The contract for the host, the server, and the window is [[303715ed]]; here is what the stream code holds.

- **The live-output offset is the `pty` write offset.** The base is the write's `durableThrough` when the logic assembled the execution (`OpenInput`), plus the bytes the stream pump has read since. The pump is the fd's only reader, and the main loop writes into the write exactly what it took from the pump, so the write and the live output match byte for byte. Same after a logic change: the predecessor's unread buffer reaches the successor as the first `pendingEchoes`, its pump reads that buffer first, and the successor's write continues from the end of the predecessor's write. If the main loop started reading the terminal before `OpenInput` (only adapter tests do that), the base is unknown: the terminal has no live output, and opening a lane answers `LaneUnserved`.
- **The tail runs at least two read buffers ahead.** The write lags the pump by no more than the buffer the main loop has not taken yet plus the chunk it is writing. A viewer that read the write to its end continues from that offset out of the tail; an offset behind the tail answers `behind`.
- **A lagging viewer is closed, not left dropping frames.** Bun drops a frame past `backpressureLimit` (it equals the tail), and such a skip would break the match with the write; so a dropped frame closes the connection with code 4408, and memory under a viewer never grows past the tail.
- **A lane lives while its binding lives.** `Bindings.released` answers when a binding left the table for any reason — close, execution owner change, epoch, or the host's custody release; on that fact the execution closes the lane in the stream. `Bindings` learns of a custody change from `Custodian.moved` and cleans the table at once: the window connection lives past the server, and lazy cleanup at the next open would leave the previous custodian's lane printing. The stream also applies the owner change and `CloseBinding` itself in the same step as input (`EndLanes`, `CloseLane`), so no act of the old owner passes between custody acceptance and lane end.
- **Admitted-input events merge by (binding, cause) pair, and memory under them is bounded by the live binding count.** Presses don't wait on them: the stream sends an event to the main loop after the receipt but keeps at most one packet per terminal in flight. Following events wait for the packet's acknowledgement, merging by pair, so a frozen main loop piles up no message queue. An `Inputs` subscriber out of credits holds the last event of every cause of every binding (`LaneInputs`). A binding that left the table leaves with all its events. Merging by binding alone won't do: `raw` after text would hide the print, and deciding which cause counts as printing is the server's call.
