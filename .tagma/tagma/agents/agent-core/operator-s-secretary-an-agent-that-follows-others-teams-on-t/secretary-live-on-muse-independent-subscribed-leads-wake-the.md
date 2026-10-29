---
id: 01a16503-2038-72ab-9b6b-2a4585675cad
title: "Secretary live on Muse: independent subscribed leads wake the subscriber once for \"rested\"; a performer's question is answered by its lead"
ord: 7
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "confirmed"
  }
edges:
  - kind: relates
    to: 01a164ef-091c-77ef-bb7c-9ff888b55e10
---
**Hypothesis.** A subscriber to a team root receives:
- exactly one "rested" — after the whole team's work ends;
- "addresses a human" — while the team is still working;
- "awaits the operator" — only for a question whose approver is the operator.

The lead answers its performer's question, not the operator.

**Setup.** 2026-10-22, server built from `2ff9251860` — with all spec commits up to `bae834eefe`. The subscriber is thread `01a163ff-c890-77a1-9b13-0dd3a3d0c9c2`: a `tagma` agent on claude-code/claude-opus-5-5 xhigh, without the secretary definition. Two roots birthed via `spawn_agent` with `link: root` and `subscribe` on muse-spark-1.3-contributor xhigh:
- lead A (`01a164ed-f909-7f4e-9d15-5bef4aad5683`) launches two performers on Muse and ends the turn at once with a line to the operator. worker-1 asks the lead via `ask_user` which language to answer in; the lead answers with `answer_approval`;
- lead B (`01a164ed-f8f7-70fa-8ace-7ba10b986708`) creates and closes a task in the graph, then poses the operator a question via `ask_user`.

`subscribe_threads` and `unsubscribe_threads` by list on already existing threads, subscribing to self, and `read_attention` verified separately.

**Observation** (from thread records and activity):
- Both leads were born as roots: `parentThreadId` empty, the tree root is the lead itself. The subscription recorded all five waking events.
- Lead A:
  - "addresses a human" arrived while the performers were working;
  - intermediate turn ends (after launching children, after answering the performer) produced no events;
  - "rested" arrived exactly once — after the summary;
  - worker-1's question recorded with approver lead A and closed with the `ru` answer;
  - the lead's final answer arrived via `send_message final`.
- Lead B:
  - "closed the task" arrived; the test task was later deleted;
  - the `ask_user` question arrived as "awaits the operator";
  - the question was removed via `interrupt_agent`, and `ask_user` returned `cancelled`;
  - "rested" arrived once, the final answer arrived.
- Subscribing to self refuses with `subscribe-self`. Unsubscribing from a thread with no subscription answers `unheld`. `wakes` narrows the waking events.
- Defect: while worker-1's question awaited the lead, `read_attention` served it to the operator as `awaiting`, although the approver was lead A. Task [[88b55e10]].
- Both test roots stand in "Attention" as finished after the end — supporting the [[475314ba]] idea.

**Conclusion.** Independent roots, subscription at birth, the "rested", "addresses a human", "awaits the operator", and "closed the task" events, performer-to-lead question routing, and the root's report to its creator are confirmed.

Not verified live:
- the "crashed", "stalled", "stopped", "committed" events — they cannot be triggered reliably without breaking work or the shared repository; they are covered by performer tests;
- merging lines at a sleeping subscriber — known not to work ([[1f559854]]);
- the secretary definition itself and Muse as secretary: the subscriber was Opus.
