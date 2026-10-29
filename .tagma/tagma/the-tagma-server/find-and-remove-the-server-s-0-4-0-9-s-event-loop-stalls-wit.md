---
id: 01a14114-427f-76ac-89ed-45825df62aac
title: Find and remove the server's 0.4–0.9 s event-loop stalls with no JS sample
ord: 124
tags: ["task"]
fields:
  {
    "status": "open"
  }
---
Find and remove the server's 0.4–0.9 s event-loop stalls with no JS sample.

The Tagma server regularly stalls for 0.4–0.9 s with a `blocked` cause, and the profile shows no JS sample for that time. Example: stall `925446e7` (484 ms, 15.10 20:50:48): dictation tore because of it, after which the sound helper and browser send received a 10 s reserve. A second example is `fed03673` (430 ms). Neither git nor checkout is involved, so the mechanism is shared. A stall report names the first JS frame after the sample gap as the frame, so `CheckoutBaselines.ts:319` stands there by mistake (reflection `5d2889dd`).

Two hypotheses are untested:
- stop-the-world GC in JSC: heapUsed grew from 432 to 608 MB over 35 s with no dips;
- the loop thread got no CPU: load average during measurements was 58–61 on 12 cores, and machine load at the stall moment was not recorded.

Start here: raise a dev server with `BUN_JSC_logGC=1`, reproduce load with agents, and match GC pauses against stalls from `read_performance` (`stalls`). If GC is confirmed, look for who grows the heap rather than tuning the collector.

Done when the sampless stalls have a measured cause named and it is fixed at its owner, or proven to be outside the process (OS scheduling), and recorded.
