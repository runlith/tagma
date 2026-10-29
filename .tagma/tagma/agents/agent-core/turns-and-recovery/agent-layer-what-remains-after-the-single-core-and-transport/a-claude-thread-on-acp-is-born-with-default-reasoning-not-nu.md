---
id: 01a1528f-9986-72d5-a106-7bcebe1c935c
title: A Claude thread on ACP is born with default reasoning, not null
ord: 38
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fb-6ae2-72a7-8565-b02edaf63602",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1527f-3515-7a77-a22e-b43bc6d116f7
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/protocolActs.stest.ts
---
`composition/testing/threads/protocolActs.stest.ts` fails one test in five: a Claude thread on ACP is born with `reasoning: null` instead of `'medium'`, and the check stands before the first turn. Project rules require a Claude thread on ACP to be born with model and reasoning like a native one (e5eed6b8, af264e00). So after recent birth-path edits — model choice at outside-thread birth (6229df6b, `b22e8598ce`) and the Claude Code vs Claude split on ACP — reasoning is lost somewhere.

To do: find where reasoning choice at Claude-thread birth on ACP becomes `null`, and fix at the birth model-choice owner. Never weaken the test.

Done (`fed34d08cf`). Reasoning was lost not in the outside birth path (`b22e8598ce` never touched that branch) but in the birth-choice owner `BirthModelSelection.selection` (`native-harness/models/preference.ts`): the `null` ("model default") rung of a saved operator choice went into the thread line as is — for native and for ACP seating, which takes the same choice (`acts.ts` → `HarnessRegistry.seating` → `acpKernel`). A test world with `69d976f8e1` keeps exactly that choice (`hostedDefaults`, `reasoning: null`). Now that branch resolves the `callRung` — `null` → the model's `defaultReasoning`; a named rung stays (operator-only included; `spawnReasoning` would lower it). Saved defaults stay `null`; only the birth choice materializes. Checks: `protocolActs.stest.ts` 5/5; `defaultModel.itest.ts` — new test: Claude Code and OpenAI with an unnamed rung are born on `medium` and `high`, a named `low` stands; typecheck of files clean. Review with no findings.

Proof: `protocolActs.stest.ts` 5/5; native and Claude-on-ACP births with no explicit choice give the same default model and reasoning.
