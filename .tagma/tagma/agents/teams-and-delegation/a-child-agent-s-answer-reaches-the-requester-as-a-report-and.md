---
id: 01a14bae-6720-7d62-897a-927a1d3e398d
title: A child agent's answer reaches the requester as a report and continues their work
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9277306eedae
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92794b55f4da
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92876d791728
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92913ae88b52
  - kind: supersedes
    to: 01a14b6d-b1e4-7a98-a753-c8f42318f063
sources:
  - kind: file
    ref: packages/agent/src/collaboration/ThreadEnvelopes.ts
  - kind: symbol
    ref: packages/agent/src/collaboration/collaborationVerbs.ts
    symbol: SEND_MESSAGE
  - kind: symbol
    ref: packages/agent/src/collaboration/CollaborationVoice.ts
    symbol: closingReminder
  - kind: symbol
    ref: packages/agent/src/collaboration/reporting.ts
    symbol: reportOwed
  - kind: symbol
    ref: packages/agent/src/collaboration/reporting.ts
    symbol: withdrawQueued
---
**Value.** The parent neither waits nor polls the children: the answer arrives on its own and opens its next turn.

**How.** The child's final answer is `send_message` with `final`; without it Tagma sends the report.

**Behaviour.** For an ordinary agent the report opens a turn; a workflow-requested report is kept for the engine without starting the managing model. The delivery method belongs to the saved request and is the same for the final answer and the fallback report. The final answer closes all this agent's open requests, whichever run it came from. When work ends with no answer, the parent once receives the last message of the run where it ended, and for a failed or cut run — the diagnosis. A run after which the child still awaits a report from an agent it gave work to (say, its reviewer) does not report: the report leaves at the end of the run where nobody is left to wait for. A child that changed something and still owes an answer gets a reminder before the end. An assignment the operator took from the child's queue before it started returns to the sender as withdrawn.

**Limits.** A run stopped by the operator or the parent stays silent: no report leaves for the parent or for whoever interrupted. The final answer goes to one agent, and only to the one it is owed to.
