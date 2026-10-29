---
id: 01a0de66-e14b-7756-9254-1e3e66443549
title: Should a whole-call rule bound the call end to end, and what is paid for it — the command's own budget, or the record of what it wrote?
ord: 5
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a0dbac-14e8-7aff-a0c7-0c2684694b75
sources:
  - kind: symbol
    ref: packages/agent-tools/src/bash/preflight.ts
    symbol: beforeTheCommand
  - kind: symbol
    ref: packages/agent-tools/src/ShellRun.ts
    symbol: ShellRun
---
A bash call is four things in a row: the reading before the command, the command, the measurement that attributes what it wrote, and the answer. The first two now share one clock from the call's start ([[c28e2112]]), so the rule holds through the command's ending for the price of nothing anyone was using. What the clock does not reach is the measurement.

**The first price is already paid, and it was not the one this note first named.** Taking the reading's share out of the command costs the program-rule extension only for a call whose time a whole-call rule decides — and such a call was never extended. A call with no rule over it is untouched.

**Answering before the measurement ends, and finishing it afterwards, does not work here, and the reason is measured rather than argued.** The measurement is a capture and then a landing: reading each moved path, diffing it against what stood before, then writing the row. Only the landing can be deferred — it already has durable custody, a row that cannot be written waits as a file until it lands ([[bc1dd73a]]). But the cost is not there: with a change port that costs nothing at all, attributing four hundred rewritten files still takes about four seconds ([[18ff9b7c]] carries the table). Deferring the landing therefore removes none of it.

Deferring the capture instead is not a scheduling question but a correctness one: the attribution rests on two readings bracketing the command with nothing between them ([[49d34463]], [[701e98e1]]), and a text read after the answer is whatever the next writer left. To defer it safely one must first capture what is being deferred — and capturing is the cost. That is the END: **the deferrable part is not the expensive part, and the expensive part cannot be deferred without attributing another session's bytes to this command.**

So what is actually open is narrower than this note began with, and narrower again since the measurement's own cost was fixed ([[18ff9b7c]], commit d4391b4927).

**What that fix settled.** The measurement no longer grows with the size of the files a command touched: attributing 400 rewritten files of 20 KB fell from about 220 s to 343 ms, and the whole call — reading, command, attribution, answer — from about 220 s to 579 ms. It now costs roughly 45 ms per MiB rewritten on one machine and grows with the bytes, which is the floor: a text must be read to be attributed to anyone.

**What remains open, exactly.** A whole-call rule still bounds only the reading and the command; the attribution after the command runs outside that clock and states its overrun rather than being cut. At the rate above, a one-minute rule is reached by a command that rewrites on the order of a gigabyte under `produces` — a build tree, not an edit — and the figure is one machine's, so the boundary is read off the rate rather than fixed at a number. Below it the overrun statement never fires.

So the price is still unpaid, and worth paying only where that floor is genuinely reached; if it is, it is one price, not two: cut the measurement at what the clock leaves and name every path it did not reach, which leaves those lines visible but belonging to nobody and unlandable by `submit_work`.