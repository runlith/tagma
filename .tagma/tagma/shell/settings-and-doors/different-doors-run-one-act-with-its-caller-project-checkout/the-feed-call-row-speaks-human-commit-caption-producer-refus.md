---
id: 01a160b9-e5c2-79a2-8938-2d8c1adc643e
title: "The feed call row speaks human: commit caption, producer refusal phrase, rule instead of law"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a160b3-a6b5-7d00-8ea6-237124fdeb0e",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a146ca-49a1-756b-8020-330d35c0e724
---
The feed call row says what a plain user will see, not mechanics and codes: at `submit_work` now "Committing this session's own paths · law violated" — the caption describes mechanics, the tail glues the app from the refusal code (`refused: (code) => code.replaceAll('-', ' ')`), and so any refusal comes out in the feed.

To do:
- the `submit_work` caption speaks of the commit: going — "Committing "<subject>"", done — "Committed <short sha> · <subject>"; at the presentation owner, not in the app;
- a feed refusal is the producer's phrase: every declared refusal code has a human phrase, its owner module declares it (server) or the tool (packages), the call record carries it in `toolRefusal.words`, and the app shows it and no longer makes a word from the code; a rule refusal is "Blocked by rule "<name>"";
- the word "law" is not visible in the interface: the `law-violated` code becomes `rule-violated` everywhere — the refusal contract, prompts, the rules skill, tests, graph blocks; sibling `law-*` codes are decided by the same principle.

Check — a feed look on its own tagma:try before and after.
