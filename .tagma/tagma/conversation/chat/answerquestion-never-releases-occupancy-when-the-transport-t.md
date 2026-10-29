---
id: 01a0ca95-d05f-72de-bfcc-b8396379f372
title: answerQuestion never releases occupancy when the transport throws
ord: 74
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
Send, compact and continue all release occupancy in a finally (packages/chat-ui/src/ChatTurns.svelte.ts:376,417,489), but answerQuestion clears its busy mark with a plain statement after the await (:544-546) and has no try/finally: if the transport throws instead of answering a status, busy stays 'answer' and every later send, compact, continue and answer is refused or silenced for as long as the chat lives. Either the transport is trusted never to throw — in which case the three finallys say otherwise — or answer needs the same finally. Evidence: the three guarded verbs against the one unguarded arm.