---
id: 01a107e9-9f14-7212-9e39-474323d47c58
title: "Cause: the machine slept with its lid closed, and each DarkWake expired the liveness deadline on every open thread"
ord: 3
---
Providers never went silent, and the generations were not long. From 04:03:17 UTC to 12:06:59 UTC the laptop lid was closed: `pmset -g log` records “Entering Sleep state due to 'Clamshell Sleep'” and ends with “lidopen … DarkWake to FullWake”. For all eight hours the machine slept, waking roughly every 15–17 minutes into a 35–130 s maintenance DarkWake.

**Evidence**
- Each `StreamStalled` batch ends in the same second on every thread and provider (Opus and Sonnet, openai-oauth Astra): 04:19:52.8, 04:36:05.8, 04:55:35.8 … 11:44:35.7, 12:06:24.8. Each of these instants is a `DarkWake` line in `pmset -g log`, accurate to the second (the log records local time, +0200).
- Between these instants the server vitals have gaps of 912–1009 s of wall time. An interval that survived the sleep lasts 920 s by `Date.now()` and 1.3–5 s by `performance.now()`.
- The parent's steps `01a10189` run only inside DarkWake windows. Twice it collected `stalled` itself (07:40→07:57, 08:59→09:07).

**Mechanism.** The `liveness` watchdog set its deadline on wall clocks. Bun timers run through sleep and fire all at once on wake. So at every DarkWake each open thread collected `StreamStalled`, although the provider had not been silent for a single second of wakefulness. During 30–60 s of wakefulness the parent continued its children. Their new steps received their first frames, the next sleep froze them, and the next DarkWake killed them.

**Where the remaining symptoms come from**
- “Attempts open in the same millisecond and stayed open” is the bootstrap GET of the Claude Code presentation (settings, policy_limits…), not model threads. The trace hangs every step request's outcomes on the first attempt: task [[0fcb2de4]].
- “Breaks in the middle of tool-call arguments” is simply where the thread was when the machine fell asleep.

**Fixed in `45550c24ac`.** The watchdog counts the window on `Clock.monotonicTimeNanosUnsafe()` (in Bun this timer stops while asleep) and only while a pull is outstanding. The test models machine sleep on model clocks and fails before the fix. The note [[556861ee]] explains why.

**What this does not fix.** With the lid closed agents cannot advance. Tagma holds `caffeinate -i`, but per `IOPMLib.h` that assertion does not prevent lid-close sleep and does not hold in Dark Wake.
