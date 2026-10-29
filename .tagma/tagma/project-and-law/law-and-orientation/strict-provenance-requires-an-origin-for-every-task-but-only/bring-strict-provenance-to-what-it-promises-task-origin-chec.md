---
id: 01a14c37-8dd7-7aa7-99cf-79299de5f7f9
title: "Bring --strict-provenance to what it promises: task origin checking or an honest flag text"
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a14c14-a11c-7ce8-9d84-6323e8224d0b
---
The `--strict-provenance` flag promises every task has an origin. In reality it's one line in the managed AGENTS.md section: nothing refuses a task without an origin, and native agents don't see it because the managed section is cut out of context files (`stripManagedLaw`). Decide which is right and fix the other side. Done when the flag and its description say the same thing.
