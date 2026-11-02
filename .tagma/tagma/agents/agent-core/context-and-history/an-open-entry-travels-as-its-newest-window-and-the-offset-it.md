---
id: 01a19886-87c1-73cc-be38-e7a2bc5865ef
title: An open entry travels as its newest window and the offset it starts at; a reader reads the prefix it lacks by range
ord: 20
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a12f9e-80f1-7ed1-92f3-cfa80ee6585c
  - kind: relates
    to: 01a190c6-9088-7be5-8efe-8b03a3cb3d23
sources:
  - kind: file
    ref: packages/agent/src/transcript/feedFold.ts
  - kind: file
    ref: packages/agent/src/transcript/openText.ts
  - kind: file
    ref: packages/chat-ui/src/session/ThreadSession.svelte.ts
  - kind: symbol
    ref: packages/agent/src/thread/run/ThreadSnapshots.ts
    symbol: makeThreadSnapshots
---
An open entry's growing field — an answer's or reasoning's text, a tool's streamed input — crosses every frame as at most its newest 64 Ki UTF-16 units, with `from`, the offset that window starts at. Without the bound, every snapshot, `attachFrom` and reopened `put` repeated the whole text, so one long answer made each frame as large as itself.

- **The reader owns completion.** A reader joins a window with the prefix it already holds (`joinedOpen` in the feed fold), so a reconnect while the text grows costs nothing it had. Only what it lacks, `[0, from)`, it reads by range through `read_thread_text` (`thread.text` on the socket), newest page first, until `from` is 0. A page that no longer meets the held start is dropped; a landed record supersedes the open entry.
- **Ranges are UTF-16 units, the unit of `append`.** A window or a range never splits a surrogate pair: a start inside a pair moves forward, an end inside one moves back, so a read answers within the range it was asked and its `from` says where it really starts. A range's `limit` is at most an eighth of the byte page: one unit encodes to at most six JSON bytes, and the rest is room for the frame around the text. A growth chunk larger than the window crosses as a fresh window `put`, never as one `append`.
- **A reader re-reads when its window moves.** A page that answers an older window is dropped, and the read starts again from the window that replaced it; a read that met nothing new does not repeat until the window moves.
- **The range read answers from any source with the same bytes**: the live lane while the entry is open, the journal record once it landed, the run's stream tail between them. That holds because an open field only grows by appending under its id and its record carries the text it streamed.
- **A frame from before offsets reads as starting at zero**, both a bare open entry and a `put` without `from`.

This bounds frames, not memory: each server layer still holds the whole open text until a durable prefix lets it go.
