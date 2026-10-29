---
id: 01a11bdd-9a36-7b41-aa58-22dbe8ba4977
title: "Registries: merge ThreadRunClosing into rules, close a withdrawn contributor's question and resource, thread opt-in for modes"
ord: 1
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a11901-5360-733e-9ca2-9127629ac667
  - kind: implements
    to: 01a118eb-3e7e-7085-8f2e-2cd3bb429da3
---
Finish what [[629ac667]] left of [[bb429da3]]:

- Merge `ThreadRunClosing` into the rule pipeline: closing-guidance becomes a run rule on its own hook, not a second channel of the same shape (`thread/run/runClosing.ts`, `agent/AgentTurn.ts`). The same place currently holds a `console.warn` and a catch-all over closing-check failures.
- A withdrawn contributor closes its parked question with a typed outcome.
- A withdrawn kind's resource leaves a release obligation in the ledger with a typed refusal (`resources/threadResourceLedger.ts`).
- Modes: opt-in on the thread; the mode picker at thread birth in settings comes from the registry, not from `BUILTIN_MODES`.
- Contributor namespaces for ids, if naming both sides on collision proves too little.

Done when each of these is covered by a contract test through the owner's public operation.
