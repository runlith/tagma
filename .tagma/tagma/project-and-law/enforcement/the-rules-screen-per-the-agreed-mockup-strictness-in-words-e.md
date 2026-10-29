---
id: 01a15a02-4fdb-7009-a8f6-3748f4e52ddd
title: "The Rules screen per the agreed mockup: strictness in words, escaped on top with actions, strictness switch, empty project with two entries"
ord: 60
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1550c-eab4-7571-a25c-65cd95e90199",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15999-729b-7cc3-be53-cd4a6258036f
  - kind: waits-on
    to: 01a159e7-85d5-71ad-9cb6-d4bcb495071b
---
Rework the Rules screen (list, rule page, empty project) per the mockup at http://localhost:5634/a/0e8b653e0a04. The mockup is agreed with the operator.

- **List:** strictness in words next to the dot (Blocks / Warns / Text); header state — rules, checking, escaped, known debt; row tail one main thing: escaped, debt or clean; a quiet "could be checked" at a textual measurable rule; a rail Rules-item badge while unviewed escapes exist.
- **Rule page:**
  - a strictness switch, on Blocks — a decision window over escapes in bulk: fix now or debt for a task;
  - escaped cards on top with point, fix and actions: fix by agent, open file, keep as known;
  - empty debt and refusals — in one line;
  - what it checks — as a phrase; technique folded into Details.
- **The switch stands at every block with the `core/law` role, not only at enforced.** Right now `BlockFacts` shows the section only when `tags.enforced(read)`. A textual rule has "Text only" active, while Warns and Blocks lead to a check choice: "Ask Tagma" with the rules skill or a key from `tagma.config.ts`. The condition follows the contract, not the tag name.
- **Title:** code in the rule title draws, with no literal backticks.
- **Empty project:** a promise and two entries — "Ask Tagma" (a thread with the rules skill and a ready question, sent by the human) and "Write one yourself"; examples also open a thread.

Waits on b495071b: the same `features/rules` folder and the finding `said`/`fix` fields. Proof is a live `tagma:try` window on law-lab and public-contract tests where they exist.
