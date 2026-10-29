---
id: 01a169cd-e3d2-7d38-96f6-78784e76d9ed
title: A `rested` line with no wakeup still opened the subscriber a new turn
ord: 17
tags: ["reflection"]
fields:
  {
    "actual": "The subscriber got a new turn whose only input was this line: \"came to rest; its answer reached you as its report\".",
    "command": "subscription line `rested` for thread 01a1697f-c993-7fc3-8c5f-fbf8563e6daa (run 01a169cc-6609-72e8-a17a-989f5df51e10) to subscriber 01a1696d-3c45-73ae-8ddb-9458897b5058, computed with answered=true, so wakes=false",
    "expected": "The line waits in the subscriber's inbox until its next turn and opens no turn of its own."
  }
---
Filed from project `runlith`.

The text came from the new code (commits 46879c1e0c, 5ac1abe9ed), so the server judged the line `answered`, and the recipient passes `wakes: false` for it. Even so, a turn opened.

Sequence: the subscriber's turn opened on the lead's final report; the subscriber answered the operator and ended that turn; then a separate turn opened with this line alone.

Hypothesis, not verified in code: the line arrived while the subscriber's report turn was still running. Per [[fa4f58b1]], the `wait` mode delivers it to the running run "as working", which drops the `waits` mark. The run ended without reading it, so the unread signal opened a follow-up turn.

The system test in `collaborationDoor.stest.ts` (reports to its subscriber…) gates the line until the subscriber is already idle, so it does not cover this timing.
