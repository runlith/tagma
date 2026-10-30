---
id: 01a15546-c8d5-7af0-8cac-ef9af07eeb40
title: A run failure from a defect (TypeError) keeps the stack in neither the thread record nor activity — it is grepped from serve.log
ord: 14
tags: ["reflection"]
fields:
  {
    "actual": "Only message and 'TypeError' type; the stack (utf8ByteLength ← boundDisplayText ← initialToolDisplay ← call.ts:162) was found only through rg over ~/.tagma-dev/serve.log",
    "command": "read_thread_record threadId=01a125fe-9260-7644-9a64-589c9bc19e19 at=transcript:error:01a15539-2f26-7c38-95b5-66c8766b2318 and activity:01a15539-d079-7c0c-9c31-b50260e46a",
    "expected": "A defect's failure record or model-call activity carries the exception stack so the cause reads from the thread record"
  }
---
The server knows the stack: it prints it to serve.log as the `cause` of `ThreadCallBroke`. Only `message` and `diagnostics.type` reach the thread record, and the `model-call` activity gets `reason: Defect` and message. To find the defect's owner, the run had to leave the operations for the process log.
