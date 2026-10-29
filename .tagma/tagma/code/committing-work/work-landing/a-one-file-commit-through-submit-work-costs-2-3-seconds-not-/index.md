---
id: 01a15417-4ea3-7cfd-8032-89c71b48552d
title: "A one-file commit through submit_work costs 2–3 seconds, not 11: rule judgement is parallel and incremental, landing git goes direct"
ord: 31
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/judging/judge.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/commit.ts
---
A one-file commit through `submit_work` should cost seconds. Right now it costs ~11 s. Target — 2–3 s on a typical runlith landing under ordinary load, with no softened judgement: the same rules, the same verdicts, the same refusals.

## The sample the work starts from

2026-10-19: 5 landings of a one-line edit in `apps/tagma/server/src/platform/contract/wire/conditions.ts`, no import changes, in a separate worktree on the working server. No other landings in the window, so the per-step counters belong to these landings alone. In parallel another agent ran a heavy command, so machine load was uncontrolled. One sample.

- `submit_work`: 11.9 s on average; without the first landing in the checkout — 10.7 s (8.6 / 10.4 / 12.8 / 11.0).
- Rule judgement (`enforcement.judgement`): 7.2 s on average — about 2/3 of the landing.
  - The `bun checks/law/program.ts` process for 8 program rules: ~2.6 s per judgement, no cache (sampled via `check_law` staged, 2 runs). In `judge.ts` builtin rules start only after `judgeBindings`.
  - The platforms rule (`50520d64`): cold check of a new worktree — 7.8 s; new tree on a warm base — 3.1 s; repeat of the same tree — 0.3–0.4 s. Separate worker on commit `0e10c130`: cold 10.6 s, warm base with a changed tree — 1.7 s (537 rechecked entry points), all warm — 60–100 ms.
- Preparation (`prepared.prepare`): ~2 s (commit steps ~1.2 s, of which `oxfmt` ~0.4 s; tree assembly ~0.5 s). First landing in a new checkout — 8–16 s.
- 20 git calls through the execution host per landing: 90–180 ms on average per call vs ~10–15 ms direct.
- After publication: index update — 0.33 s, line bookkeeping and hooks — ~0.4 s.

## What changes

1. **Program judgement runs together with builtin-rules judgement**, not before it. Owner — `apps/tagma/server/src/enforcement/judging/judge.ts`. Expected effect — ~−2.5 s.
2. **The platforms rule does not re-walk the graph when the load graph could not have changed.** When nothing the walk reads changed in the changed files, the base's verdict carries over to the new tree with no walk: imports and exports, `package.json`, route options, file makeup. When it did — only what depends on the changed files is recomputed, not the whole package. Owner — the platforms package in `apps/tagma/inspection/src/packs/js/platforms` and its worker. Expected effect — −3…−4.5 s.
3. **Program judgement does not pay process start and full parse for a one-file edit.** First sample what takes ~2.6 s inside `checks/law/program.ts`, and remove it at the owner: in the program, in the call protocol, or in how the server calls and caches it. Expected effect — up to −2 s.
4. **Landing git that only reads, or writes only to the server's internal index, goes direct, with no execution host.** Host-routed stay calls where repository code executes or checkout files are written: commit steps and hooks. This partly revisits the [[27cfd1e3]] decision to keep admission on every git; the basis is the sample above. Expected effect — −1…−2 s under load.
5. **The first landing in a new checkout** does not cost 8–16 s: find what takes it and remove it at the owner.

## Acceptance

- Repeat sample, 5 one-file landings with no import changes in a separate worktree on one's own instance or the working server: `submit_work` median — at most 3 s without the first landing; rule judgement — at most 1 s. Each part closes with its own before/after sample on the same scenario.
- No rule loses violations:
  - platforms: an edit adding a forbidden import still refuses `law-violated` with a chain;
  - programs: an effect-style violation in the changed file still refuses.
- The owners' existing tests green; `bun run typecheck` clean.
