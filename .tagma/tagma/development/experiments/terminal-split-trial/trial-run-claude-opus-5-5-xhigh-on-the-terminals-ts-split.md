---
id: 01a0e4b8-ab0a-7b5f-a809-9bbc2eee2abb
title: "Trial run: Claude Opus 5.5 xhigh on the Terminals.ts split"
ord: 2
tags: ["research"]
fields:
  {
    "source": {
      "name": "claude-opus-5-5 xhigh, tagma agent terminals-opus",
      "ref": "branch trial-opus at 6eec31a9f8, base 25c3297851"
    }
  }
---
Opus produced the architecturally cleanest cut so far: the contract is written out and free of the implementation, the class sits in its own file, and parts take the state as an explicit argument with no cycle between them. It was slower than Astra and ran no review.

**Run.** Started 22:44:46, one commit `6eec31a9f8` at 23:13:21 — 28.5 minutes; no helpers, no review. Graph untouched; `check_rules` over the change (a read) found no violation. Typecheck passes (~45 s); 242 unit tests pass (agent's run, not repeated here).

**Result.** `Terminals.ts` deleted; ten files: `service.ts` 330, `live.ts` 139, `start.ts` 492, `reads.ts` 414, `input.ts` 334, `custody.ts` 384, `stops.ts` 280, `commandActs.ts` 99, `discharge.ts` 353, `refs.ts` 28. 65 paths, 54 importers moved to the defining files, no re-export.

**Card fidelity.** One deviation from the map, justified: a tenth file `live.ts` for `LiveTerminals`, because the contract must hold the tag and its faces type and the class listing every member fits no subject part. Helper placement follows callers, each deviation named (`unwitnessed` → `live.ts`, `reproject` → custody, `retaken` → refs; `ref`, `gateOf`, `forgetEndedLanes` became instance methods since several parts use them on the instance's state). `HOST_INVENTORY_PAGES` dropped after a repo-wide check. Local renames to avoid clashes (`launch` → `launchOf`) keep span names.

**State.** Correct: lanes, gates, `moved`, survivors and `openedAt` exist only as fields of the one `LiveTerminals`; every part function takes it as an explicit first `self` parameter.

**Architecture of the cut.**
- `service.ts` is a real contract: 58 members written as `TerminalsFaces` with explicit types, no runtime import of any part — it can move to `contract/service/terminals.ts` as the card intends. One residue: a type-only import of `TerminalDischarge` from `discharge.ts`, which the agent itself names.
- No runtime cycle among parts: parts import `live.ts` type-only and reach each other through the instance (`self.record(…)`); the only runtime edge between parts is `reads → discharge`.
- `live.ts` delegates each member in one line (`(...args) => start.start(this, ...args)`).

**Cleanliness.** Bodies are the original text with `this.` → `self.`; plain `Effect.fn` generators with `self` first — no duplicated signatures, no `.bind`/`.call`. `TerminalsFaces` sits close to the existing `TerminalFaces` in `terminalsLayer.ts` (the agent flags it; section 5 renames that one later).

**Behaviour.** Evidence is typecheck, unit tests and "bodies are the original text"; no mechanical equivalence check was offered. One side effect disclosed: members are now bound arrows, so a member detached from the object works where it used to fail — harmless.

**Beyond the brief.** It noticed that 50 graph blocks are anchored to `Terminals.ts` (symbol anchors included) and will need re-anchoring — a real consequence the brief did not mention and the other runs have not raised.

**Score (1–10).** Compliance 10 · card fidelity 9 · state 10 · architecture of the cut 9 · cleanliness 9 · behaviour evidence 7 · speed 8.
