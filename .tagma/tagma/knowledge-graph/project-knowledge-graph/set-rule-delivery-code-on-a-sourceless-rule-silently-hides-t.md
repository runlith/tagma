---
id: 01a165a2-014a-7d93-be76-6b00ddff721b
title: set_rule_delivery code on a sourceless rule silently hides the law from agents, while its gate keeps refusing
ord: 199
tags: ["reflection"]
fields:
  {
    "actual": "answer only 'start of a new tagma thread: −143 characters'; read_block 'delivered: code · no sources'; reading packages/ui/src/index.ts did not deliver the rule; the gate stays on the whole reach",
    "command": "law-lab: set_rule_delivery 1f4c22f7 delivery=code (rule without sources, gate before submit_work on the whole reach)",
    "expected": "a refusal or at least a warning in the answer: the rule has no sources, the text in code mode will reach no agent, while the check judges the whole project; exits: add sources or keep prompt"
  }
---
Filed from project `runlith`.

An agent gets rule-violated on a law it never saw in the instructions. Experiment: step 21 under b85acc68.
