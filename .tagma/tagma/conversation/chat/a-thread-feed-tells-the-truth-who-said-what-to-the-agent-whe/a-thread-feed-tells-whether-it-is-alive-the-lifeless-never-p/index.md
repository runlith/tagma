---
id: 01a15ba6-6aca-7c3d-990f-134895cada01
title: "A thread feed tells whether it is alive: the lifeless never pretends to be alive, a failure names itself, a run stop is named"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a12f9e-8106-7371-95b7-ec9e651a2eb8
---
**Outcome.**
- **The lifeless does not pretend to be alive.** While a thread feed is not reading, the last known picture stays on screen marked "as of HH:MM" — the moment of the last frame. Run and step clocks stand. An unclosed call shows "state unknown", not "Running". Limit and "background"/"stop" buttons exist only on a command the live command entry confirms as running; a finished command shows the exit code and duration.
- **A failure names itself.** "Reconnecting" means only one thing: the socket to the server is gone. When the server breaks a subscription with a defect, the run row says "Thread not showing: <reason>" and gives "Copy details"; background resubscription proceeds as decided in [[651a2eb8]]. The banner without a picture ("This thread could not be read") shows the same reason and that attempts continue.
- **A stop is named.** A run whose transport lost the turn and is restoring it ([[700ff263]]) says so in the run row and the thread-list row instead of the nameless "no movement for a long time". A run that ended in failure shows the reason and "Continue".

**Why.** On October 20 thread `01a15ac1-2b9a-7fc6-b993-3b1f606e8186`:
- showed "Running … 13m 22s" on a command that finished in 51 s;
- wrote "Reconnecting" for 13 minutes while the socket was alive — the server failed every subscription with a defect;
- showed "run 21m 9s" on a 34-minute run (clocks fixed in [[4059886a]]);
- stood as "no movement for a long time" in the thread list without a reason.

The client knew the reason: `ThreadSession` distinguishes socket loss (`interrupted`), server defect (`ChatFeedBroken`), refusal (`ChatFeedRefused`), and gaps (`FeedGap`). But `runVerdict` reduced all lifelessness to one `unknown` phase — "Reconnecting".

**Owners and mechanics.**
- **Kit** ([[cb732496]]). `FeedReading` carries the lifelessness kind and the last frame moment. The verdict is derived by its owner `FeedVerdicts`, one for all consumers ([[b7bb8a8f]]). Time behind feed-row clocks freezes at the last live moment in a lifeless feed. An unclosed call of a lifeless feed gets an "unknown" verdict.
- **App.** Phrases live in product rows. The command row (`features/threads/native/calls.feed.svelte`) takes "running" only from the live command entry, and shows its end on a closed call.
- **Core and ACP.** The transport reports the run-stop reason it knows (recovery after driver death) via `RunStatus`; the list row is led by its owner ([[13bda205]]).

**Acceptance.**
1. Session test: a subscription ending in a server defect gives a "not showing" verdict with the defect text, not "Reconnecting". Socket loss is "Reconnecting". After recovery the verdict is live again.
2. Feed test: in a lifeless feed step and run clocks do not grow, and an unclosed call does not show "Running".
3. A run restoring after an ACP driver death names it in the run row and the list row. Proved by a system test on the [[700ff263]] rails.
