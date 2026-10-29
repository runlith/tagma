---
id: 01a14b97-0ba9-7319-ad50-4239c34a6c2b
title: A withdrawn operator message still reached the hosted Claude model in the next turn
ord: 170
tags: ["reflection"]
fields:
  {
    "actual": "The feed hides the withdrawn message, but the model received it glued in front of the next message as one user turn, and acted on it: it sent oracle2-opus a conversion task the operator had withdrawn; the operator had to stop that child",
    "command": "Operator sends \"hand it to the same opus that did this right now, all of it\" (run 01a14b93-c2ac…), then stops/withdraws that turn (journal #18876 withdrawal, keepMessages 821); then sends the next message (#18877) in thread 01a125fe-9260-7644-9a64-589c9bc19e19 running on Claude Agent SDK",
    "expected": "The withdrawn message leaves the model history with its turn, as the feed shows: the next turn's model input holds only the new message"
  }
---
Filed from project `runlith`.

Journal: #18873 message (run 01a14b93-c2ac-7bad-bc49-3111537eb540, text "hand it to the same opus that did this right now, all of it…"), #18876 withdrawal {runId 01a14b93…, keepMessages 821}, #18877 next message. The agent's next turn opened with both texts in one user message. The thread is a native Tagma thread, not the hosted Claude path. Likely place: the native harness's next-request history is not cut back to keepMessages on withdrawal. Cost: one unwanted child task started and stopped, operator confusion about a UI/model mismatch.
