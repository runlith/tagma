---
id: 01a14b6d-b1e4-7a98-a753-c8f42318f063
title: A child agent's answer returns to whoever gave the work as a report that opens their next turn
ord: 5
---
Whoever launched the agent or gave it the job receives the answer as a report that opens their next turn: the parent need not wait or poll the child.

**How.** The child answers with `send_message` with `final: true` — this closes all its open requests from this agent, whichever run it was sent from. When the run the work arrived in ends with no final answer, the run's last message leaves instead; a run that failed or was cut sends the diagnosis; other runs send nothing. A child with no `send_message` (plain terminal CLI) knows from its birth note that the run's last message will be its answer. A child that changed something in the run and still owes an answer gets a reminder with a ready call before the end.

**When there is no report.** The operator stopped the run — silence. The parent stopped it — no report leaves for the parent, nor for the agent that interrupted it. A keep-warm run does not report. An assignment the operator took from the child's queue before it started returns to the sender as a "withdrawn" report.

**Limits and refusals.** The final answer goes to one agent per call (`final-to-many`), with no `inReplyTo` (`final-in-reply`), and only to the one it is owed to — otherwise `no-open-request`; the request of an already deleted thread is closed in the process. The report wakes the parent's wait: a tool that merely waits ends, a foreground command moves to the background.

**Relations.** Launching the child; messages and assignments; the operator sees waits and run endings in the list and through `read_endings`.

Code: packages/agent/src/collaboration/reporting.ts#reportOwed, packages/agent/src/collaboration/reporting.ts#withdrawQueued, packages/agent/src/collaboration/ThreadEnvelopes.ts, packages/agent/src/collaboration/CollaborationVoice.ts#closingReminder, packages/agent/src/collaboration/collaborationVerbs.ts#SEND_MESSAGE
