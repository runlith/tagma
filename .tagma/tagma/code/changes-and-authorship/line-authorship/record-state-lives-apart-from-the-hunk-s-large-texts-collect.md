---
id: 01a13274-aa21-721e-98e9-b212fb3c8142
title: Record state lives apart from the hunk's large texts; collection has its own durable index
ord: 41
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/record/hunks.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/texts.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/store/tables.ts
---
A record line's state transition must never re-read and rewrite its large hunk. The change record keeps one logical record in two physical places: `workspace_change` holds identity, coordinates, digests, geometry, and state; `workspace_change_text` holds the nullable oldText/newText under the same row id. This is one owner's data, not a second authorship model. A missing payload keeps the earlier null contract. The FK over the full PK and ON DELETE CASCADE leave no text without a record.

Operator intake and merge change metadata and payload in one write unit; evidence reads and lazy hunks join them in one SQL snapshot. Stamping stays metadata-only and keeps after-CAS and command-window guards. The durable `workspace_change_retired_text` queue serves as the index of hunks awaiting collection: a metadata transition to committed/withdrawn and a payload insert of an already completed record add it via SQL triggers of the same transaction. The collector reads the queue, counts committed added/removed in a worker, and atomically records counts and deletes the payload; deleting the payload cascades its queue off. The authoritative state stays in workspace_change and is rechecked before collection.

One heavy migration copies the existing payloads, creates and fills the queue, drops the old partial index, and removes old_text/new_text from workspace_change. One current reader/writer, no runtime fallback. Proven estimate before implementation: max(rowid) 265305, 265300 records, 932 payloads / 248671529 bytes; DB file 20.49 GB with 2.08 GB WAL, 170.42 GB free. The Platform estimate readonly of the new migration confirmed max(rowid) 265564 and a data snapshot of `workspace_change` and the ledger; no file participants for them, tables with indexes took about 563 MB. Platform recomputes rowid bounds and the snapshot/file size before handover on heavy.json; the workspace_change data snapshot and rollback must keep ids, digests, states, and FK witnesses. Old migrations never change, the live server never restarts.

Acceptance: a fresh and an upgraded fixture read the same logical evidence; the merge never tears the metadata/payload pair; after-CAS, the command window, and released witnesses keep working; collection leaves counts and removes only completed lines' payload; rollback restores the earlier form. The matched 406-file / 637-held / 235 MB / 160k-ended scenario compares the SQL engine and Retirer.leave, not just the shared submit. Carries out the [[527738d1|stamp cost task]].

The [[eefb0e60|operator-holder spec]] stands: its logical semantics and merge never change. [[9129dec4|command-created file recovery]], [[5b4a6709|durable Holdings memo]], and [[e87e8682|nobody-line claiming]] stay out of scope; UI, git, enforcement, and prepared.shape never change.
