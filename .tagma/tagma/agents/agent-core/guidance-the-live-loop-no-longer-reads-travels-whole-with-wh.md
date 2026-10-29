---
id: 01a18951-1f1c-77e7-83d0-9d3dd1c9c481
title: "Guidance the live loop no longer reads travels whole with what the thread records: the parked question, the answer, the call-ending notice"
ord: 203
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/agent/src/agent/door/ToolExecution.ts
  - kind: file
    ref: packages/agent/src/thread/run/ParkedQuestions.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/calls/delivery.ts
  - kind: symbol
    ref: packages/agent/src/agent/AgentSignal.ts
    symbol: agentSignalMessages
  - kind: file
    ref: apps/tagma/server/src/threads/collaboration/callEndings.ts
  - kind: file
    ref: packages/agent/src/thread/transport/native/launches.ts
---
A guide reaches the model through the live loop's step guides only while the loop that queued it still plans another step. Three cases outlive that loop. In each, the guides travel whole — text, `state`, `retell` — with a record the thread keeps, and the next request reads them as guidance messages. That way a rule judging by told state (a capability cue, the notes rule) sees them as delivered instead of offering them again.

- **Parking.** Guides still queued when a run parks — a parked call's `beforeTool` context, an answered sibling's `afterTool` context — ride the parked question (`guidance`). They are written after the question's results when it ends: answered, lapsed, stopped, cleared or moved to the background. Written at park time, they would put a user message between a tool call and its result. A run that ends without parking writes its untold guides as a guidance event at its end.
- **The answer door.** Guides of the calls an answer runs are written in the same transaction as those calls' results.
- **A background call.** Its outcome keeps its guides. The owed-call row stores them until delivery, and the call-ending notice carries them. Turning a signal into messages adds one guidance message per guide right after the notice (`agentSignalMessages`), both in the live step and in the recorded signal event. A call handed to a managed command normally leaves its ending to the command's notice; when it has guides, it sends its own call-ending notice so they arrive.
