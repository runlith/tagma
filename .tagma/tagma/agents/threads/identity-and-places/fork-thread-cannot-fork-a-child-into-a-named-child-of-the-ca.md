---
id: 01a0e39a-f664-757f-a0d2-64349d1e2bdb
title: "fork_thread cannot fork a child into a named child of the caller: the fork is an unnamed root shown as \"fork (tagma)\", outside the team, with no report back"
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "fork_thread takes no name and no parent: the fork is an independent root titled \"fork (tagma)\", send_task reports `sameTeam: false` and `name: null`, it gives no automatic report, and the caller has no child-management access to it. spawn_agent's `fork` copies only the caller's own history, never a child's.",
    "command": "fork_thread(threadId=spec-modules (a child of the tagma agent), carry=all), then send_task to the new thread id to give it section 7 of a spec",
    "expected": "A way to fork one of my own children with its full history into a new child of mine: a team name I choose (e.g. `spec-cards`), shown under me in the thread list, reporting its final answer back like a spawned child, compactable and stoppable by me."
  }
---
Filed from project `runlith`.

Use case: parallelising spec work by forking a warm author (section 1's author, ~500k tokens of read code and decisions) so a second writer starts with the same map instead of re-reading it. The workaround was a brief telling the fork to reply by send_message final=true to the parent's thread id. Wanted, by meaning: the source of a new thread's history is an input of birth, and being the caller's child is what birth by the caller makes. So spawn_agent's `fork` should accept a source thread — `fork: { from: <thread in the caller's lineage>, carry }` — with the source's model as the default; fork_thread stays the independent branch (a root, the operator's act). Teaching fork_thread to make children would duplicate spawn's contract (name, report, rights, reach, model) in a second door.