---
id: 01a0e4ba-a1a2-7c96-afc3-e902702e9009
title: "Trial run: GPT-6 Sol xhigh on the Terminals.ts split"
ord: 3
tags: ["research"]
fields:
  {
    "source": {
      "name": "gpt-6-sol xhigh (openai-oauth), tagma agent terminals-sol",
      "ref": "branch trial-sol at 111648f6f9 plus 51 uncommitted files, base 25c3297851"
    }
  }
---
Sol did not deliver: the branch head does not build, because 51 importer edits written by its Muse helper were never committed. The cut itself works in the working tree but is structurally weaker than Opus's and Astra's.

**Run.** Started 22:44:47; commits `9afd7da6ab` (23:12:10) and `111648f6f9` (23:15:33); 51 files still uncommitted at the report. Three Muse helpers (within the limit). The importer helper wrote the importer edits in its own session; Sol then tried `submit_work`, which takes only the session's own lines, and stopped there. `submit_work` has a `taking` parameter that carries a stopped descendant's held paths — the recovery existed and was not used. Graph untouched, no integration tests.

**Result (working tree).** `Terminals.ts` deleted; nine files: `service.ts` 155, `start.ts` 517, `reads.ts` 417, `input.ts` 317, `custody.ts` 376, `stops.ts` 268, `commandActs.ts` 99, `discharge.ts` 352, `refs.ts` 484. Typecheck and 232 unit tests pass on the working tree (agent's run); HEAD alone does not compile.

**Card fidelity.** Helper moves follow callers and are named (`standing`, `commandRecord`, `nameSurvivor` into reads; `reproject` into custody). But `refs.ts` — mapped as a few shared identity helpers — is 484 lines, because it also holds `TerminalImplementation`, a full internal interface of the instance; the file no longer carries its subject. `LiveTerminals` and the factory `createTerminals` sit in `start.ts`, mixing the class into the start subject.

**State.** One `LiveTerminals`; each subject exports a factory (`readsMethods(self)` and the like) whose methods close over the instance, and the constructor merges them in with `Object.assign(this, …)`. The state stays single, but the object's shape is assembled at run time rather than declared.

**Architecture of the cut.**
- The contract depends on the implementation: `TerminalsService = Pick<TerminalImplementation, …>`, imported from `refs.ts`, which in turn imports `TerminalDischarge` from `discharge.ts`.
- `start.ts` imports every other part at run time to build the instance.
- No cycles between the subject parts themselves.

**Cleanliness.** Closure factories keep bodies close to the original, but the 484-line `refs.ts` and the `Object.assign` mixin are the least readable structure of the runs so far.

**Behaviour.** Typecheck and unit tests on the working tree; no equivalence check; the recorded branch is broken.

**Score (1–10).** Compliance 7 (delivery incomplete) · card fidelity 6 · state 8 · architecture of the cut 5 · cleanliness 6 · behaviour evidence 5 · speed 6.
