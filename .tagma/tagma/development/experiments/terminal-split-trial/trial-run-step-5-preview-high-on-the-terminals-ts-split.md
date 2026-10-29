---
id: 01a0e4cd-424b-7716-8597-9aa601899a59
title: "Trial run: Step 5 preview high on the Terminals.ts split"
ord: 5
tags: ["research"]
fields:
  {
    "source": {
      "name": "step-5-preview high (stepfun), tagma agent terminals-step5",
      "ref": "branch trial-step5 at 4c0be6a06d, base 25c3297851"
    }
  }
---
Step 5 delivered a complete, committed cut with correct state handling and a stated line-level loss check, but the slowest one, with the contract typed by the class, the internal state published in the contract file and runtime cycles between parts.

**Run.** Started 22:44:5x; one commit `4c0be6a06d` at 23:36:42 — about 52 minutes; clean tree. No helpers. Graph untouched, no integration tests.

**Result.** Ten files: `service.ts` 175, `liveTerminals.ts` 455, `start.ts` 508, `reads.ts` 479, `input.ts` 388, `custody.ts` 425, `stops.ts` 327, `commandActs.ts` 133, `discharge.ts` 400, `refs.ts` 24. Every importer moved, no re-export. Typecheck passes; 205 unit tests across 21 files pass (agent's run, not repeated here).

**Card fidelity.** Tenth file for the class, like Opus and DeepSeek. `ref` renamed `operationRef` (reason: it builds an `OperationRef`) — a rename the card did not ask for. `unwitnessed` into `input.ts` (the input gate's default witness). `retaken` placed in `reads.ts`. `HOST_INVENTORY_PAGES` dropped after a check. The class file is named `liveTerminals.ts`, repeating its folder's subject.

**State.** Correct: `LiveTerminals` builds exactly one `TerminalsState` and passes it to every part as `w`.

**Architecture of the cut.**
- The contract is not separated: the tag is `Context.Service<Terminals, LiveTerminals>`, and `service.ts` also publishes `TerminalsState` — the constructor dependencies and the private per-instance state — as part of the contract.
- Runtime cycles between parts: `reads ↔ discharge`, and `discharge → input → reads → discharge`. Parts reach each other through namespace imports rather than through the instance.
- `liveTerminals.ts` is 455 lines of delegation, the heaviest wrapper of the runs.

**Cleanliness.** Free functions with an explicit state parameter, but the parameter is named `w` — an opaque one-letter name across every part.

**Behaviour.** It reports a line- and token-level comparison of the old file against the new ones: differences only in removed `private`, receivers, four listed renames and the dropped constant. Not repeated here.

**Score (1–10).** Compliance 10 · card fidelity 7 · state 10 · architecture of the cut 5 · cleanliness 6 · behaviour evidence 8 · speed 5.
