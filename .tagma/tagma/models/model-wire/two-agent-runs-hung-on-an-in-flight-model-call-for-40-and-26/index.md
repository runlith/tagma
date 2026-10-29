---
id: 01a0c97f-58ae-7ce0-825b-36dfe9f93dfe
title: Two agent runs hung on an in-flight model call for 40 and 26 minutes with nothing abandoning them, and only a hand stop-and-continue recovered them
ord: 52
tags: ["reflection"]
fields:
  {
    "actual": "Both runs sat with a model call in flight that never returned and nothing abandoned it. Thread 01a0c957-cae2-77e0-ab6a-38b3310ee6fa completed step 12 at 13:41:02 and was still on step 13 at 14:21; thread 01a0c964-6c84-7e27-aded-2fb0f6a8b2ae completed step 24 at 13:54:31 and was still on step 25 at 14:21. Both showed as working and running the whole time. stop_agent then continue_agent recovered both over their own history with nothing lost.",
    "command": "spawn_agent (zone-builder on muse-spark-1.3-contributor at max), then list_agents and read_thread select=steps to check progress",
    "expected": "A model call that goes silent past the host's stall window is abandoned as its own outcome, so the step fails or retries and the run either progresses or ends with a failure its parent is told about"
  }
---
Filed from project `runlith`.

The cost was about 66 minutes of two builders' wall time, and it was invisible from the outside: list_agents reported both as working/running, and the thread row's `updated` stamp is durable movement rather than step movement, so a hung run and a slow one look identical there. What distinguished them was read_thread with select=steps — the last MEASURED step time. A parent watching a pool has no cheaper signal than that, and no signal at all that says "this run has not completed a step in forty minutes".

Two separate things would each have caught it. If the stall window the kernel declares per call had been in force here, the silent call would have been abandoned as its own outcome and the step would have failed visibly instead of hanging; whether the host states one for these runs is the question that decides whether this is a host configuration gap or a defect in the wire. And if list_agents carried the last completed step's instant beside context usage, a stalled agent would be one reading away instead of three.

Recovery worked cleanly once diagnosed: stop_agent then continue_agent, with 153 and 176 records and the full context preserved. That is not a restart of the agent and loses only the hung call, but a parent has to know to reach for it, and the failure gives no hint because there is no failure — the run simply never moves.

Filed while running the agent-kernel zone cover. The two builders were reading, not writing, so nothing durable was at risk this time.