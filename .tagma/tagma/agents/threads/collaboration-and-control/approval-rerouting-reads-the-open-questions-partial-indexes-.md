---
id: 01a15225-ddb1-7c13-9b6b-ef1cfb0986e6
title: Approval rerouting reads the open questions' partial indexes after MachineStore migrations
ord: 7
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a151df-e920-73d7-9b09-09d80c12ca5d
sources:
  - kind: file
    ref: apps/tagma/server/drizzle/20261019025551_open_questions/migration.sql
  - kind: file
    ref: apps/tagma/server/src/threads/approvers.ts
  - kind: file
    ref: apps/tagma/server/src/threads/store/kernel.ts
---
A grant record must not grow costlier with the closed question history. A partial index alone does not guarantee this: on the full fixture SQLite preferred the shared record-type index, so the query is explicitly tied to the open-question indexes. The subscription is created after MachineStore fully opens and captures its db: without the applied migration INDEXED BY would refuse the query. One-time history-index construction is declared a heavy migration; later grant changes read only standing questions. The same selection serves the archive-mark change. The route depends on whether the parent is archived, so `ThreadRecords.shelfRecorded` names threads whose mark changed after commit: archive and restore, mark removal by a run start and by a reader's word. The subscription reroutes those threads' and their children's open questions in a separate fiber: the run-start record runs under the thread journal's lock, while reroute itself writes questions. Without this a live child's question would stay behind an archived parent, and a returned parent would not get it back. A status-only transition with no run change (CLI session) does not check the mark: an extra request in this record would slow every such transition. The same selection serves a plugin's `on.asked` being registered or withdrawn, and any change of the enabled plugins: those reroute the open questions of the threads bound to a plugin, read by summary per open question. A reroute failure is only written to the journal, as on grant change.
