---
id: 01a0e4b6-77ac-7343-a3b6-f9bb4cd69962
title: "Trial run: GPT-6 Astra xhigh on the Terminals.ts split"
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "gpt-6-astra xhigh (openai-oauth), tagma agent terminals-astra",
      "ref": "branch trial-astra at 96f1459ad6, base 25c3297851"
    }
  }
---
Astra finished first and cleanly within the brief, with one real architectural flaw: the service contract is derived from the implementation, so the contract file cannot stand apart from it.

**Run.** Started 22:44:47, commits `e2bacaf582` (importers) and `96f1459ad6` (split) by 23:03:55 — 19 minutes; final report after two Muse reviews at about 23:12. Two Muse helpers (whole-change review ~5 min, performance/state ~3 min), both found nothing. Graph untouched, no integration tests. Report: the agent's scratch `final-report.md`.

**Result.** `Terminals.ts` deleted; nine files: `service.ts` 388, `start.ts` 497, `reads.ts` 455, `input.ts` 355, `custody.ts` 408, `stops.ts` 313, `commandActs.ts` 120, `discharge.ts` 378, `refs.ts` 32. 64 files changed, 54 importers moved to the defining files, no re-export. Typecheck passes; 232 unit tests in 23 files pass (agent's run, not repeated here).

**Card fidelity.** Helpers follow their callers; deviations are reported and each is justified by the call sites (`unwitnessed` beside the constructor default, `reproject` with its two custody callers, `commandRecord`/`typedBy` in reads, `retaken`/`ref` in refs). `HOST_INVENTORY_PAGES` confirmed unused and dropped. Names: `TerminalsOwner` → `Terminals` tag, private `LiveTerminals`.

**State.** Correct: `agentLanes`, `executionGates`, `openedAt`, `moved`, `namedSurvivors` are allocated only on the one `LiveTerminals`; parts receive it as `this`.

**Findings from reading the code.**
1. *Contract depends on implementation (significant).* `TerminalsService` is 58 lines of `OmitThisParameter<typeof start>` and the like, so `service.ts` imports every part at runtime, and `LiveTerminals` with `makeTerminals` sits in the same file. The card's target for this part is `contract/service/terminals.ts` — a contract dependents import without the implementation. As cut, that file cannot move there; the class belongs in its own implementation file and the contract needs written method types. The original also typed the service by its class, so behaviour did not regress; the cut just did not take the separation the card intends.
2. *Runtime cycle `reads.ts ↔ discharge.ts`.* `reads` calls `discharge`/`abandonAndDischarge`; `discharge` calls `readRecord`/`commandRecord`. It works because nothing runs at module load, but two subjects now depend on each other.
3. *Noise from the `this` style.* Every part is a free function typed `(this: TerminalState, …)`, with the signature written twice (annotation and generator), bound in the class by 58 `.bind(this)` lines, and cross-part calls go through 107 `.call(this, …)`. Correct, but heavier to read than parts taking the state as an argument.

**Behaviour.** The agent reports a static AST comparison matching all 95 original method bodies and 37 helpers after normalising receivers and names. A line-level spot check here (sorted, receivers stripped) leaves only signature and call-site rewrites in the difference, which is consistent with that but does not independently prove it.

**Score (1–10).** Compliance 10 · card fidelity 9 · state 10 · architecture of the cut 6 · cleanliness 7 · behaviour evidence 8 · speed 10.
