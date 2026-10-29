---
id: 01a121e1-8304-7f20-b17b-923faa4c97b5
title: Should a broadcast recipient see its other addressees
ord: 1
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
Question: should a broadcast recipient see its other addressees, like mail To/CC, or does each recipient receive the envelope as a single send, like BCC.

The spec chooses BCC: then neither the envelope body, nor `AgentSignal`, nor the markup changes, and a sender for whom it matters names the addressees in the text.

What showing would give:
- a broadcast reads to the recipient as a broadcast: "everyone stop editing F" does not look like a personal rebuke;
- recipients can agree with each other without `list_agents`.

What it costs:
- an optional addressee-list field in the envelope body, an attribute in `agentSignalMarkup`, and display in the app signal;
- tokens in each recipient's context: a name costs about 3 tokens, and another team's thread id, where the name does not resolve, about 20;
- the risk of extra chatter between recipients: "did you get this too?".

Examples will decide the choice: whether broadcast recipients in practice need coordination with each other, or everything they need the sender writes in the text.
