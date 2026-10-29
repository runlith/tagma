---
id: 01a0e4b6-66eb-7139-ba25-d27ee56dce90
title: Terminal split trial
ord: 3
---
Six models each did the same real restructure task in isolation, to decide which model the restructure waves send where. Each child `#research` node is one model's run, read and scored by the coordinator; a blind cross-comparison follows once all runs end.

**Task.** Split `apps/tagma/server/src/terminals/Terminals.ts` (2,649 lines) into nine files by subject, per the executions card of section 7 ([[f7e0b9dd]]) and the names of section 5 ([[243fd181]]). Brief: `terminals-split-brief.md` in the coordinator's scratch. Agents were not told it is a comparison.

**Setup.** One worktree per model, all cut from `restructure` at `25c3297851`: `trial-opus` (claude-opus-5-5 xhigh), `trial-astra` (gpt-6-astra xhigh), `trial-sol` (gpt-6-sol xhigh), `trial-muse` (muse-spark-1.3-contributor max), `trial-ds` (deepseek-v4.1-flash max, via Devin), `trial-step5` (step-5-preview high). Started together at 22:44 local. Constraints: graph read-only, no tasks, no integration or system tests (typecheck and unit only), helpers only Muse and at most three, commit on own branch. Ceiling two hours.

**Scored on.**
1. Brief compliance — constraints kept, helper limit, graph untouched.
2. Card fidelity — nine subjects, helper placement by caller, `start.ts` under 600, no re-export.
3. State — one `LiveTerminals` instance, one semaphore set and gate map.
4. Architecture of the cut — contract separable from implementation, no runtime cycles between parts, how parts reach the shared state.
5. Code cleanliness — noise added by the cut, naming.
6. Behaviour preserved — evidence offered and how far it goes.
7. Time to last commit, time to final report, helpers used.

**Results so far.**

| Model | Done | To last commit | Typecheck / unit | Main finding |
|---|---|---|---|---|
| Astra | yes | 19 min | pass / 232 pass | contract derived from implementation; `reads ↔ discharge` cycle |
| Opus | yes | 28.5 min | pass / 242 pass | cleanest cut: explicit contract, class in `live.ts`, no part cycles; no review run |
| Sol | no: 51 importers uncommitted, HEAD does not build | 31 min (partial) | pass on working tree / 232 pass | contract from implementation; 484-line `refs.ts`; `Object.assign` mixin |
| Muse | no: stopped at ~55 min with no changed file | — | — | not suited to a whole-file architectural cut |
| DeepSeek | yes | ~48 min incl. Devin quota outage | pass / 156 pass | Opus-like shape (`live.ts`, explicit instance); contract typed by the class; `retaken` misplaced in start |
| Step 5 | yes | ~52 min | pass / 205 pass | contract typed by the class and publishes internal state; `reads ↔ discharge` cycles; 455-line delegation file |

Server load during the run is a separate observation: seven streaming threads saturated the main Tagma process (stalls of 0.3–0.9 s, seven in ten seconds), from per-chunk work that §3.13 ([[9c085c6c]]) removes.
