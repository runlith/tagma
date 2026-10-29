---
id: 01a0cf56-2827-7f36-a2d4-6c54da58f62e
title: "Phase 2: an execution's grid is kept by the host and carried in its record, so every view draws at the size the bytes were written at"
ord: 10
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
## 1 Outcome

The grid an execution stands at is a fact of the execution, kept by the host and written into its record. Every view applies each change at the byte where it happened:
- a view on the same page;
- a view in another window;
- a replay of an hour-old record;
- the live feed.

A full-screen program such as Claude Code or Devin is never drawn at a width it was not laid out for. Who decides the grid is unchanged from [[22097468]]: per terminal, the view the operator last typed into, with the last admitted resize standing. Every other view now follows the host.

## 2 Problem

After [[22097468]] every live view learns the grid the server applied, but only when the server's message arrives, not at the byte it took effect at, and every replay lays the bytes out at whatever size its engine happens to have. A Claude Code thread resized mid-output, or replayed, therefore draws the bytes around the resize at the wrong width.

## 3 What holds now

- **The record** carries the pty stream alone [[9f0a244c]] (`packages/executions/src/recordFormat.ts`). Readers refuse a format version they do not know [[3c66d7ef]].
- **The records tree** is removed whole when a new host boots on the same state directory [[e2910415]].
- **The screen feed** carries the geometry with every frame, but a pane follows the byte record.
- **`TerminalGrids`** publishes the grid per page, and a replay writes into the engine at its current size.
- **The wire's pinned fingerprint** covers the `Bytes` delivery, the `Read` answer and `ExecutionSummary` (`wire.test.ts`, [[d93d53b0]]), so adding a field to any of them raises `WIRE_VERSION`.
- **Artifact compatibility** answers `Incompatible` on a record-format mismatch (`artifact.ts`).

## 4 Target model

- **A grid track beside the pty stream.** A terminal's record carries one entry per resize the host applied, each naming the grid and the pty offset it holds from, plus the grid the execution was born at.
- **Delivery.** Readers get the entries with the bytes, and every view resizes its engine to each entry before writing the bytes after it.
- **The pty stream** stays exactly what the child wrote.

## 5 Parts and owners

### Host record — `packages/executions` (format, protocol), `packages/execution-host` (writer, readers) ([[271ce57d]])

- **Writing.** `ExecutionInput` applies a resize. At that moment it hands `ExecutionRecord` the new grid, which writes the entry at the pty offset its writer stands at, in the same storage act.
- **Delivery.** The bytes subscription and the window reads carry the entries in the range they answer, ordered with the bytes. The execution's state answers the current grid.
- **Format.** The record format version moves by one. Readers read the new version and the one before it, and the old one reads as a record with no track.

### Views — `RecordStream`, `TerminalPane`, `TerminalGrids`, `TerminalFit` ([[5f7838e9]])

- **Every view** resizes its engine to each entry before writing the bytes after it.
- **The deciding view** keeps refitting at once as in [[22097468]]; when the resize comes back as an entry, it follows the entry. A refused resize returns it to the recorded grid.
- **The server's grid message** from [[22097468]] goes: the entry in the byte stream replaces it.
- **A box that differs from the grid** draws the grid and leaves the rest of the box empty, or scrolls.

## 6 Rejected

- **Resizes written in-band into the pty stream as an escape sequence.** The record would no longer be what the child wrote, offsets would shift, and every raw-bytes reader would meet a sequence no program sent.
- **Following the screen feed's geometry alone.** It covers the live view but not a replay, and it costs a second feed per pane.

## 7 Acceptance

**The host's record suite:**
- two resizes land as two entries at the offsets they took effect at;
- a window read over a range that holds a resize answers the entry together with the bytes;
- a sealed record read after its host is gone still carries the track;
- the pty stream's bytes and offsets are identical with and without resizes;
- a record of the previous format reads as one with no track.

**Live:**
- one Claude Code thread open in two windows of different sizes draws correctly in both, and the window not focused shows the focused one's grid;
- a record resized twice replays each part at the size it was written at;
- `TerminalGrids` no longer publishes.

## 8 What stands

- **Revised:** [[9f0a244c]]: a terminal records its pty stream and a grid track.
- **Stands:** [[3c66d7ef]], with the version moved.
- **Absorbed:** [[358c9a63]] and [[9b0db2d4]]. The replay orders entries with bytes, and a tail replay starts at the grid standing at its first byte.
- **Dies:** the page-local publish claims under [[fe4e48f2]].

## 9 Order

The host record part comes first, then the views. Both land as one release.

## 10 Contracts

- **Record format:** a new track, and the format version moves by one.
- **Host wire:** the `Bytes` delivery, the `Read` answer and `ExecutionSummary` gain the grid, so `WIRE_VERSION` rises by one over whatever stands. The release says so.
- **Server socket and HTTP:** `terminal.bytes.subscribe` and the bytes window read carry the entries. `read_terminal` gains the current grid.

## 11 Stored data

- **The format moves by one version,** and readers read both. The host still removes the records tree at its next boot.
- **Rollback:** an older reader refuses new-format records [[3c66d7ef]]. Rolling back loses readable history for records the newer host wrote, until the next boot removes them.

## 12 Who may do what

out: no act changes who may do what. The track is read wherever the bytes are read, under the same scoping.

## 13 Long-lived things

out: the track lives and dies with its record.

## 14 Bounded resources

- **Size:** one entry per applied resize, a few dozen bytes.
- **Rate:** only a terminal's deciding view proposes resizes, and a divider drag sends at most one per drop [[f58668dd]].
- **Retention:** entries are retained with the bytes they precede, plus the one entry standing at the oldest byte held.

## 15 Rollout

- **The wire rises and the record format moves.** A standing host is incompatible with this server, so this phase lands only through a restart while no execution is live. A live old host is kept, and its terminals refuse until it is replaced [[4473e762]].
- **Work that never ends** is answered as in [[22097468]], section 15.
- **Coordination:** it may share a replacement with a release of [[8cb4e34f]] ready at the same moment, such as that decision's stage 3. A release raises the wire at most once.
- **Until [[fb5c1b45]]**, this is work that has to wait for running work to end.

## 16 Failures

- **An entry that could not be stored** marks the record's tail lost with its recorded cause, the way a failed byte write does [[925985ec]]. It is never silently short.
- **A view that meets an entry** applies it before the next byte, never later.

## 17 Observability

- `read_terminal` answers the current grid.
- A replay of a resized record is the visible check.
- The host's record span counts entries beside bytes.
