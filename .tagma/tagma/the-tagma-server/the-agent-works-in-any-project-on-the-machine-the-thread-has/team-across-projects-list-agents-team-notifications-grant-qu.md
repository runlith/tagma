---
id: 01a1278d-8205-7cda-9971-7eb581db2784
title: "Team across projects: list_agents, Team, notifications, grant questions, and reports see the child in another project"
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1278d-b747-7ba6-92a3-34beedd58873",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a126b3-84d8-7b0e-a605-99311013e071
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/teamDirectory.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/teamPlaces.stest.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/threadList.ts
  - kind: file
    ref: apps/tagma/server/src/threads/store/directory.ts
  - kind: file
    ref: apps/tagma/server/src/threads/turns/reader.ts
---
Implemented: the spec's "Team across projects" section [[1013e071|agent working in any project on the machine]]. Machine-wide `list_agents` reads principal streams across homes, with pagination and `projectId` in each row; unscoped and archived records are excluded. `ThreadDirectoryRow` and `ThreadDirectoryEntry` carry `projectId: number | null`: null for the coreless adapter without projects. The roster prints the project id.

The project list of B keeps B's home, A's Team window includes descendants across homes. Starting a foreign child returns the old family to the already open feed; archiving, restore, and delete reach each of its projections. The audience is indexed by stream, reads during a snapshot are preserved, window replacement and the last unsubscribe free membership and held counters. The working-family selection is limited to trees represented in the read project.

`send_task`, `send_message`, `interrupt_agent`, the final report, and the grant question travel the existing lineage road. The notice to the parent of the operator's words no longer requires matching homes. The takeover and operatorNotice settings stay the child's home policy; the parent's grant is read from its home.

Checks: `teamDirectory.itest.ts` — 2 pass (machine page, principal isolation, project list, and a foreign run in the window); `teamPlaces.stest.ts` — 3 pass (runtime reopen over saved SQLite, family return past the window edge, wakeup, messages, final report, interrupted-run state, grant, takeover, operator notice, both archive roads, restore and delete); `audience.test.ts` — 2 pass (snapshot race and projection release). `ThreadDirectory` tests — 4 pass, `CollaborationTools` — 33 pass. Narrow typechecks of owners, bindings, and the system file passed with repository settings; the full typecheck was not run. An independent Sol xhigh and two Muse xhigh lenses read the delivery; confirmed findings were fixed at their owners in one round.

Code: `1957ab5df6`, `e620583471`. Birth via `spawn_agent project` and the app are neighboring deliveries. A physical process restart and work with a real model were not measured; the operator's running server was not restarted.
