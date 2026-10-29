---
id: 01a14b6d-b237-7cab-99f6-1b18e7ee808a
title: Operator detaches a sub-agent from its parent into its own root and returns it back
ord: 20
---
The operator takes a sub-agent from its parent: the thread with everything it produced becomes a root and lives on its own; reconsidering, the operator returns it to its place.

**How.** The `detach_thread` operation (operator only; `detached: false` returns under the thread it was detached from) and the list-row menu with Undo.

**Behaviour.** Assignments the former team gave the raised subtree, including queued ones, close with no answer; the thread's further delegation follows its own switch or the machine's. Nobody is woken: the thread and the former parent read the notification at the next step of the running run or in the next run opened for another reason. Repeated detaching answers with the same detachment. An archived thread first returns from the archive with the group. Returning puts the thread under its former parent, whatever depth that yields: the depth setting bounds only new spawns.

**Limits and refusals.** Not a child — `not-a-child`; returning what was not detached — `not-detached`; the parent in the archive — `parent-archived`; a workflow member — `workflow-member`; a name taken in the team it returns to — `name-taken`.

Code: apps/tagma/server/src/threads/contract/wire/operations/routes.ts#ROUTE_OPERATIONS, apps/tagma/server/src/threads/collaboration/detachment.ts, apps/tagma/app/src/lib/features/threads/detach.ts
