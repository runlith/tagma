---
id: 01a15ba6-6aca-7c3d-990f-1346acdc19c2
title: "A thread feed tells the truth: who said what to the agent, whether the feed is alive, and why the agent stopped — same on native and ACP"
ord: 57
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a118f1-5f59-7eb8-856a-a0deb7bb8a8f
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927c37d1b13b
  - kind: relates
    to: 01a14bc0-754e-7774-9bf0-abe5760fe634
  - kind: relates
    to: 01a15b87-fcde-7e5b-b880-a3de9e25ff6b
  - kind: relates
    to: 01a15b87-fd93-7648-ba16-03f4700ff263
  - kind: relates
    to: 01a15b87-fddb-7e4f-b689-e44daedba738
  - kind: relates
    to: 01a15b87-fe42-7050-a1fe-ca0f4059886a
  - kind: relates
    to: 01a15b88-2345-7b16-93d7-a2d1804045bc
---
**Outcome.** Anyone opening a thread — newcomer, operator, or agent — sees three things in the feed:
- who said what to the agent, in one canonical form with word fates;
- whether the feed itself is alive, and if not, why;
- what the agent is doing now and why it stopped.

The failure reason is found by reading Tagma, without serve.log and the database. Native and ACP behave the same ([[e5eed6b8]]).

**Why.** Thread `01a15ac1-2b9a-7fc6-b993-3b1f606e8186` on October 20 showed all failures at once:
- the ACP driver died on one entry, and the run stood `running` without movement;
- the feed wrote "Reconnecting" for 13 minutes on a live socket — the server failed every subscription with a defect;
- a command finished in 51 s stood "Running 13m" with no limit and no buttons;
- "run 21m" showed on a 34-minute run;
- the thread list stood "no movement for a long time" without a reason.

In the neighboring thread an operator word sent mid-turn and interrupted with Escape was executed by Claude Code, but the feed never showed it. Messages and tasks from other agents are visible only in verbose after reading, and an agent's birth task is drawn as the operator's bubble.

**Operator decisions (October 20).**
- Parent-child interaction reads like operator-agent interaction in UX: message, follow-up, task, and interrupt look the same, only the sender differs. The form is one and universal.
- Words never vanish: they have visible state.
- The lifeless does not pretend to be alive.
- A failure names itself in words and gives an action.
- Thread and operations explain a hang themselves.

**Mechanics.** Two parts — words to the agent and feed liveness — are independent in code and proceed in parallel. Diagnosing the hung ACP thread and fixing the incident itself go as separate tasks of module [[287a4906]]. The chat rebuild is led by [[b7bb8a8f]], and this spec does not contradict it: feed verdicts stay with `FeedVerdicts`, the entry kind is registered in the kit kind registry.

**Out of scope.** Rebuilding chat-ui whole; new agent-interaction kinds.
