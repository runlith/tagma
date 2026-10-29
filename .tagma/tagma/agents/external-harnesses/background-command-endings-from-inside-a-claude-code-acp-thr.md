---
id: 01a17b28-7846-76b0-9d9e-2990dc194034
title: Background-command endings from inside a Claude Code (ACP) thread turn never reach the thread and never wake it after the turn
ord: 169
tags: ["reflection"]
fields:
  {
    "actual": "No signal in the thread journal (kind=signal records — only at=1), the turn ran 90 s more and ended at=680 with the words waiting for results, the thread stood unwoken 34+ min; the commands obligation lifted (read_command without wait, printed: true).",
    "command": "bash with waitMs: 0 in the claude-code thread on ACP (01a17af8-cd0b-713c-8359-9ef824639111, at=606/609/611): three commands bd934db8, 4549e180, c6e82faf (incarnation 167), done in 2-9 s while the turn still ran.",
    "expected": "Every command ending reaches the thread: into a running turn on the next step, and if the turn ended earlier it wakes the thread (cache warm, deadline promised)."
  }
---
Filed from project `tagma`.

Time: commands admitted at 01:42:13 UTC (2026-10-27), done by 01:42:22; turn 01a17af8-ce9c-74e4-abe0-462083a55205 finished completed at 01:43:51 after ~6 more steps (at 614–677). No `kind=signal` record after at=580 in entries, and no "A command you left running has ended" text; thread activity after 01:42:10 holds only settlement and the turn-end report. The thread cache at parse time was "warm · promised", so even the old `wakeUnlessCold` rule would have woken it.

Hypothesis, unverified: the ending arrived while the turn was active and left with `ifActive: 'deliver'` into the hosted turn as a steer; Claude Code never picked it up before the turn ended, and per [[c69de975]] a released turn without sentences drops the words from accounting and leaves their state in the inbox — the next turn never opens them, and no wake follows. For comparison: in thread 01a16e20 (also Claude Code) a command ending stopped by explicit-stop arrived (#1336).

Cost: an agent that honestly ends its turn waiting for its commands waits forever; this is exactly the behavior [[b67d7441]] now relies on.
