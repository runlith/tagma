---
id: 01a1976a-113f-7e86-8bf9-288f501b5bdb
title: Projected row changes reach listeners as one sealed envelope per committed unit, captured by writer triggers
ord: 22
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a190c6-9088-7be5-8efe-8b03a3cb3d23
sources:
  - kind: file
    ref: packages/sqlite-process/src/capture.ts
  - kind: file
    ref: packages/sqlite-process/src/host.ts
---
The writer connection captures every change to a declared projected table through TEMP triggers installed after migrations, so direct writes, trigger effects and foreign-key cascades produce the same facts. A unit's facts are sealed into one envelope before its COMMIT (or a program's savepoint release) and delivered only after that COMMIT succeeded, in writer order and before the unit's after-commit tails; rollback discards them, and a failed or refused program leaves no fact and no clock step.

Authorization fires with each captured fact. A unit declaring a `WriteSet` must name every projection its effects touch; a declared set that omits one refuses before COMMIT, independently of the table-reach report mode. Units declared only by an operation name, and raw transactions outside units, are admitted for their effects, matching the boundary the table-reach gate already judges; they are still fully captured. The authorization is a TEMP table on the writer connection, rewritten only when a statement's set differs from the one it holds: its DML would reset `changes()`, so inside a transaction a `select changes()` under the same set still counts the write before it, which joined program writes and set-aside adoption count by. A sealing COMMIT and an autocommit write end with the capture's own bookkeeping, so `changes()` after them counts that, and `total_changes()` counts every capture trigger's TEMP writes: neither measures a unit's own rows on this connection. A seal advances only the shared cursor row and empties the unit's captured rows before the COMMIT, so each unit pays only for its own capture, never for its predecessor's. An autocommit write on the writer becomes its own sealed implicit unit, so no projected change escapes an envelope.

Capture, selection results and transport share one byte budget. A unit that exceeds it stays legal and yields one explicit gap at its committed cursor instead of a partial batch. The durable `__row_projection_clock` cursor advances inside the same transaction, so a reader that takes it as its first statement of one snapshot can discard covered envelopes and must recover exactly when the next delivered cursor is not the successor.

A change of the main schema is accepted only while every projected table keeps the column shape and capture triggers the install recorded; otherwise the write fails closed, since a dropped trigger or column would silently stop facts. TEMP schema changes, such as list selections pinned in TEMP tables, do not touch the capture. A restore rebinds admission inside its original transaction and commits one gap, while a rolled-back restore returns the previous capture.
