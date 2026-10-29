---
id: 01a18533-498c-79c9-9c28-7f5428d6fb47
title: Agents treat a defective submit_work refusal as a blocker and escalate it to the operator instead of committing with git or later
ord: 146
tags: ["reflection"]
fields:
  {
    "actual": "Two reviewed tasks (c89d5aac, 85b6caee) were held uncommitted as \"blocked\". A child agent (dependency-gate) was spawned to fix and review the gate in Tagma's source. The lead asked the operator three times, over about 30 minutes, to cherry-pick that fix into main and restart the server, until the operator ordered a git commit himself.",
    "command": "submit_work refused lines-held on node_modules virtual-core .d.ts (3787b73c) during the feed-e2e work; the lead agent and lists-owner then handled the refusal",
    "expected": "The work continues. The finished change lands with a plain git commit or at the end of the work, a reflection is filed, and the operator is not asked anything."
  }
---
Filed from project `tagma`.

The cause is in the agent's instructions. The commit section says to land work only through submit_work, and that landing without commit steps or with skipped hooks needs the operator's word. It gives no exit for a refusal that comes from a gate defect, so an agent reads the defect as a boundary it may not route around and escalates. Rule 35be02f0 already forbade spending effort around a Tagma defect, but did not name the commit case. On the operator's word its body now says that a commit refused by a Tagma defect never stops the work and is never taken to the operator. The root fix is the system prompt's commit section: give the gate-defect case the same default exit (plain `git commit`, or defer), so the rule is not the only place that says it.