---
id: 01a0d98f-d67f-7c3c-9dd3-353c101e739d
title: "Build the builtin `rules` agent: declaration, identity, library test and a live fixture run"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d990-0ca3-7e93-829d-b2c508065965",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d98f-a339-7f6b-aeb5-76a126598301
---
Per [[26598301]]. Done when its acceptance criteria hold.

## State

Built and committed in `d49be46b90`: the declaration and prompt under `harness/agents/rules/`, the shipped list `harness/agents/declarations.ts`, and the library test (every shipped agent is a read-only built-in whose prompt names only operations its capabilities mount). The override item became [[e0274495]], closed: customise by `extends: rules`.

## What remains: the live fixture run

It needs a server built at or after `d49be46b90`, and a real model. A scripted model in a test would only replay its own script, so items 3 and 4 of the acceptance are read off a live thread.

```
F=$(mktemp -d)/rules-fixture; mkdir -p $F/src/core $F/src/ui $F/src/app; cd $F; git init -q -b main
printf "export const model = 1;\n" > src/core/model.ts
printf "import { model } from '../core/model';\nexport const panel = model;\n" > src/ui/panel.ts
printf "import { panel } from '../ui/panel';\nexport const main = panel;\n" > src/app/main.ts
printf "import { main } from '../app/main';\nexport const boot = main;\n" > src/core/boot.ts
git add -A; git commit -qm seed; tagma project add $F --name rules-fixture
tagma ask --new --type rules --title "Rules: architecture checks for src/" "Set up architecture checks for src/"
tagma ask --thread <id> "Enable the first one"
```

Done when:
- the first answer is a proposal whose every figure appears in a `check_rules` call in the thread (read_thread), and no rule of the fixture carries an enforcement document after it (read_inspections `measured` is empty);
- the second turn makes exactly one `enforce_rule` call, and the rule's document (read_block) matches the proposal's line: inspection and parameters, triggers, strictness, debt with its owner.

Then finish this task naming `d49be46b90`, and close 26598301 into [[ade816ca]], [[14725e18]], [[315d5c1e]] and [[40fc7cb9]].
