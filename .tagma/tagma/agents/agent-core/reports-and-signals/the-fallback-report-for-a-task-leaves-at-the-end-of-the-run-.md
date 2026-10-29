---
id: 01a164a9-cf51-742c-9d01-4d1c205923ca
title: The fallback report for a task leaves at the end of the run where the work ended and holds the id of the run that took the task
ord: 8
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a16491-db29-7da9-b34b-abb0ba38afe8
  - kind: relates
    to: 01a1516c-e34f-72c8-9a7c-33f8576cd754
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/collaboration/ownWork.ts
  - kind: symbol
    ref: packages/agent/src/collaboration/reporting.ts
    symbol: reportOwed
---
The fallback report for a task leaves at the end of the run where the work ended, and holds the id of the run that took the task.

A child that handed work out itself (e.g. launched a reviewer) ends its run before finishing the task; the work ends in the run its agent's report will open. So a completed run does not send the fallback report while the child awaits a report: its inbox holds an unread report, or an open request it sent itself is not yet read out while the recipient works, has not yet passed its end's `reported` stage, or itself awaits. Likewise awaits a child — and its commission's recipient — owed the end of its own team or background call not yet read by it: the work ends in the run that reads that end. Whether an end is owed answers the `ThreadOwnWork` port (on the server — `OwnWork` from call debts, team obligations and, last, end signals still queued in the inbox without the wait mark, read in that order), and an end signal already lying unread in the inbox is recognized by the types that same port names: between the obligation's removal and the signal's reading it already stands in the inbox alone. The debt moves one way — from a background call to the team (background bash) and from a team or call to the inbox signal, each turn one record — while reads travel with no shared snapshot. Hence their order is the same: `OwnWork` reads call debts before team obligations, and the report asks the port before re-reading the inbox; otherwise a debt moved between the two reads would fall into neither. Sent requests are found by id prefix (`envelope:spawn:<thread>:`, `envelope:task:<thread>:` and `compaction:envelope:task:<thread>:` for a task with `compact`) over the primary-key range: the inbox has no sender index, and scanning all open requests grows with the machine. A new task id kind adds its prefix to `sentTaskPrefixes`, otherwise such a commission does not hold the report.

The deferred report leaves at the end of the first completed turn after which nobody is awaited, with its last message. The report's envelope and keyed act hold the run that took the task, not the current one: "is the request read out" is one read over that id, and the report leaves once, however many runs end later. Diagnoses of crashed and cut runs stay with their own end and leave at once.

A late run does not take the request while the end of the run that took the task still owes the `reported` stage: the next run opens before the reporting stages, and otherwise it would send its message under someone else's id before the taking run's report. Exception — a late run that itself read the report over handed-out work or the end of its own team or background call: the work ended in it, it sends the report under the taking run's id, and the taking run's stage, finding the report, stays silent. One window remains: if the taking run's stage stalled before a decision while the late run ended, and passed before its stage, it decides on the already read report and sends its intermediate message. Compaction and keep-warm send no late report: work does not necessarily continue after them.
