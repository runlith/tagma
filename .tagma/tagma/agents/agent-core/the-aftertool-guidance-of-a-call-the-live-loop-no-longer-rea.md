---
id: 01a18951-1f1c-77e7-83d0-9d3dd1c9c481
title: The afterTool guidance of a call the live loop no longer reads travels with the call's recorded outcome
ord: 203
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/agent/src/agent/door/ToolExecution.ts
  - kind: file
    ref: packages/agent/src/thread/run/ParkedQuestions.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/calls/delivery.ts
---
An `afterTool` rule's guide reaches the model through the live loop's step guides only while the loop that called the tool is still reading. Two calls outlive that loop, and their guidance rides with what the thread records of them:

- A call answered after a parked approval runs in a door the answer rebuilds. Its guides are collected there and written as a `runtime-guidance` event in the same transaction as the tool result, so the resumed run reads them in history right after the result.
- A call running in the background keeps its guides on its outcome (`guidance`), and the native call delivery appends them, as runtime-guidance markup, to the words of the ending notice the thread's next run reads.

Without this, a plugin's `PostToolUse` context, the touch rule's law briefs and capability cues were computed and dropped for those calls. The background road carries text only, so a guide's `state` and `retell` do not survive it, and a bash call handed to a managed command (`completion: 'command'`) still drops its guidance.