---
id: 01a0e4ca-548f-7a71-b439-0ee9b41c6ba5
title: "Trial run: DeepSeek 4.1 Flash max on the Terminals.ts split"
ord: 4
tags: ["research"]
fields:
  {
    "source": {
      "name": "deepseek-v4.1-flash max, tagma agent terminals-ds",
      "ref": "branch trial-ds at fba799130e, base 25c3297851"
    }
  }
---
DeepSeek delivered a complete, committed and fairly clean cut close to Opus's shape, but kept the contract typed by the implementing class and misplaced one shared helper.

**Run.** Commits `a800868d0f` (23:31:57, split and importers, 64 paths) and `fba799130e` (23:33:16, old file deleted); clean tree. About 48 minutes including the outage. No helpers. Graph untouched, no integration tests.

**Result.** Ten files: `service.ts` 149, `live.ts` 127, `start.ts` 504, `reads.ts` 432, `input.ts` 335, `custody.ts` 377, `stops.ts` 312, `commandActs.ts` 125, `discharge.ts` 403, `refs.ts` 22. 54 importers moved, no re-export. Typecheck passes; 156 unit tests across 14 files pass (a narrower set than the other runs; agent's run, not repeated here).

**Card fidelity.** A tenth file `live.ts` for the class, as Opus did, with the same reason. `ref` moved to `refs.ts` because twelve places call it. Two placements do not follow the callers: `retaken` stays in `start.ts` although custody, stops and command acts call it and start does not, so three parts import `start.ts` for it; `reproject` stays in `discharge.ts` although only custody calls it.

**State.** Correct: one `LiveTerminals` holds lanes, gates, `moved`, survivors and `openedAt`; parts take the instance as their first parameter; the layer constructs exactly one.

**Architecture of the cut.**
- The contract is not separated: the tag is `Context.Service<Terminals, LiveTerminals>`, so `service.ts` is typed by the class in `live.ts` — the same shape as the original, not the implementation-free contract the card targets.
- No runtime cycle between parts; the part-to-part edges (`custody → input/start/discharge`, `discharge → input`, `reads → discharge`, three parts → `start` for `retaken`) all point one way.

**Cleanliness.** Plain functions with an explicit instance parameter; bodies otherwise original. Local renames forced by the split (`standing` → `taken`, `launch` → `launched`, `terminals` → `listings`/`held`, capacity's `offersCommands` → `offeredCommands`) are all listed.

**Behaviour.** Besides typecheck and tests, it checked that all 308 string literals of the original occur the same number of times across the new files — a cheap, genuine loss check, though not proof of equal logic.

**Score (1–10).** Compliance 9 · card fidelity 7 · state 10 · architecture of the cut 7 · cleanliness 8 · behaviour evidence 7 · speed n/a (provider outage).
