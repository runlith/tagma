---
id: 01a16fd7-bb95-7838-b18d-06844c20ee1e
title: A new CLI-screen question is recorded in Questions.open but never wakes the thread subscription
ord: 17
tags: ["reflection"]
fields:
  {
    "actual": "After three green asserts the new question appears in Questions.open after ~3.5 s, but reads.subscribe(threadId), established before the read, never wakes; the test ends in a 30000 ms timeout.",
    "command": "testbed bun test --no-isolate --randomize --seed=1 terminalConformance.itest.ts",
    "expected": "After the CLI screen changes and the old question closes, the new question publishes a thread frame so the reads.subscribe reader sees the current Questions.open without polling."
  }
---
Filed from project `runlith`.

Report run.32244.1792877417888.jsonl: Esc green, the screen scenario reached the Bypass screen, answering the old question gave ThreadInteractionConflict, the old question left and stdin stayed empty; lastasking hung. Separate instrumental reading by the fix-gone-question owner saw 7 empty Questions.open, from the 8th — open WARNING Claude Code Bypass (~3.5 s). Producer chain: ledger.asked → TerminalJournal.asked → RunReports.asked → reroute. The fix went to the already-working owner 01a16fb1-a0db-75b2-804c-a7c28d2ffac4, without returning polling to the consumer.
