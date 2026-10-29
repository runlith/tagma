---
id: 01a13f2a-d143-7e69-b454-e05092ed5a4d
title: "effect-style catches time and waits past Effect inside a generator: Date.now(), new Date(), setTimeout, Promise.race, Bun.sleep"
ord: 35
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f2b-15a5-7194-82d6-b37ac1cc2d57",
    "status": "done"
  }
sources:
  - kind: dir
    ref: checks/law/effect-style
---
The `effect4` skill forbids `Date.now()`/`new Date()` (time is `Clock`) and `setTimeout`/`Promise.race`/`Bun.sleep` (waiting is `Effect.sleep`/`timeout`/`raceFirst`) inside an effect. Three bugs of that night came from here: the workflow lease in `packages/agent`, graph act stamps (6d6cf855), the host storage's stamps and deadlines. The `checks/law/effect-style` check does not see this now, so the rule rests only on agents' memory.

To do: a new shape (e.g. `clock-bypass`) in effect-style finds these calls syntactically inside the effect's `function*` (`Effect.gen`/`fn`/`fnUntraced`) and in `Effect.sync`/`try`/`tryPromise` callbacks inside it; outside an effect it does not judge. A shape test for both cases. Enabling in the rule with a gate goes through enforce_law, existing sites are recorded as debt on 449dfe0d. Proof is the shape finding the known sites, test green.
