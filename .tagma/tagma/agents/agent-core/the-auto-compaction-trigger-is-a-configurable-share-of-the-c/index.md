---
id: 01a0c568-72b8-7820-9fc7-741d77beb2b0
title: The auto-compaction trigger is a configurable share of the context window, not the output reservation
ord: 182
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/compaction/policy.ts
  - kind: file
    ref: apps/tagma/server/src/protocol/settings.ts
  - kind: file
    ref: packages/agent/src/thread/compaction/policy.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadCompaction.ts
  - kind: file
    ref: packages/llm/src/models/devin.ts
  - kind: file
    ref: packages/llm/src/models/openai.ts
---
# A configurable auto-compaction trigger

## The problem

The compaction budget is computed as `usable = context − planned`, where `planned = min(provider budget, model output)`. That reserves the whole wire cap for output, so on any row where output is at or above roughly 15% of the context the thread compacts long before its window fills:

| row | context / output | usable | share of window |
|---|---|---|---|
| devin swe-1.6 | 200,000 / 128,000 | 72,000 | 36% |
| devin swe-2 | 262,000 / 128,000 | 134,000 | 51% |
| openai-oauth gpt-5.5 | 272,000 / 128,000 (input 144,000) | 124,000 | 46% |
| openai-oauth frontier | 872,000 / 128,000 (input 744,000) | 724,000 | 83% |
| devin / anthropic 1M | 1,000,000 / 128,000 | 872,000 | 87% |
| kimi-k2.6 | 262,144 / 8,192 | 254,000 | 97% |

Measured on a live swe-2 thread (compaction `01a0c52a...:81`): `cause=projected`, `projected=134,029`, `usable=134,000`, `measured=133,491`, `cached=77,342`, `window=262,000` — compaction fired on a 29-token budget overrun and threw away 77k of warm prefix.

The most swe-2 produced in a single real call on that same thread was 3,929 tokens; of 2,230 measured calls none exceeded 5k. The 128k reservation is therefore about 32 times too large.

The original Devin CLI does not work this way: its compaction is a background summary with three thresholds read off the window (the `--compaction-thresholds` example is `183500,183500,262144`, i.e. 70%/70%/100%), and inference blocks only at the window's edge. The wire figure — 128,000 as `maxTokens` — is measured from the original and correct; what is wrong is using that same number as the compaction reservation.

Related: `input` on the OpenAI rows is not a measured provider limit but a derivation of `context − output` (`packages/llm/src/models/openai.ts`), so the branch that reads `input` carries the same illness.

## The goal

The auto-compaction trigger becomes a setting rather than a built-in number:

- the global default is **90% of the context**;
- a per-row default for a `provider/model` pair is a field in the model catalog (the mechanism is added, no values are written);
- a user override for a `provider/model` pair lives in settings.

The setting's value chooses between two strategies: a percentage of the context, or the former `context − planned` formula as an explicit conservative mode.

## The contract

**The value's mode.** Every level carries `{ strategy, trigger }`:

- `percent` with a share in 0.05–1.0 — the share of the context below which compaction does not begin;
- `reserve-output` — the former formula bit for bit, kept as a rollback path.

**Resolving the level**, most specific first:

1. the user's override on the `provider/model` pair;
2. the catalog row's default (`ModelSpec.compactionTrigger`);
3. the global setting;
4. the fallback — `percent` 0.9.

The row default in code stands above the global setting: otherwise one global choice silently extinguishes every measured value written later.

**The formula.**

- branch without `input`: `usable = ⌊trigger × context⌋`;
- branch with `input`: `usable = min(⌊trigger × context⌋, input − min(bufferTokens, planned))` — the trigger never moves compaction later than the former formula, while early shares (40%, say) are honoured;
- `reserve-output`: the former formula in both branches.

**The pair key** is `provider` plus `model`, not the model alone: the same model on different roads has different windows, prices and caches (OpenAI Sol at 70%, Devin Sol at 40%).

## The settings surface

Three keys in the `agent` section, `user` and `project` scopes, as `agent.toolOutputShare` has:

- `agent.compactionStrategy` — a choice of `percent` / `reserve-output`, fallback `percent`;
- `agent.compactionTrigger` — a `share` control, 0.05–1.0, fallback 0.9; read when the strategy is `percent`;
- `agent.compactionOverrides` — a list of `{ provider, model, strategy, trigger? }`, merged by concatenation, last entry winning (the precedent is `agents.offered`).

## The code

- `packages/agent/src/thread/compaction/policy.ts` — the formula and the resolver `resolveCompactionTrigger(provider, model, rowDefault, policy)`.
- `packages/agent/src/thread/compaction/ThreadCompaction.ts` — `prepare` (two `threadUsableTokens` sites) and `segment.usableTokens`; the compaction receipt gains `{ mode, value, source }`, where `source` is `override` / `row` / `global` / `fallback`.
- `packages/llm/src/models/description.ts` — `ModelSpec.compactionTrigger?: { strategy, trigger? }`.
- `apps/tagma/server/src/harness/compactionPolicy.ts` — reading the three keys.
- `packages/agent/src/thread/compaction/ThreadCompactionPolicy` — the `compactionTrigger` and `compactionTriggerOverrides` fields.
- The conformance log, `packages/agent/src/thread/conformance/runLog.ts`.

The wire does not change: `maxTokens` stays 128,000 on swe-2 and the model catalog is not rewritten.

## What a 90% default does

| row | was | becomes |
|---|---|---|
| devin swe-2 | 134,000 (51%) | 235,800 (90%) |
| devin swe-1.6 | 72,000 (36%) | 180,000 (90%) |
| openai-oauth gpt-5.5 | 124,000 (46%) | 124,000 (pinned by the `input` branch) |
| openai-oauth frontier | 724,000 (83%) | 724,000 (pinned by the `input` branch) |
| kimi-k2.6 | 254,000 (97%) | 235,800 (90%, safe: 235,800 + 8,192 < 262,144) |
| 1M / 128k rows | 872,000 (87%) | 900,000 (90%) |

## Acceptance

- unit tests of the formula: `percent` without `input`, `percent` with `input` (the clamp), `reserve-output` bit for bit;
- tests of level resolution: override beats row beats global beats fallback;
- an integration `prepare` on devin/swe-2 answering 235,800;
- gpt-5.5 on openai-oauth still pinned at 124,000;
- the override list: the last entry wins;
- the schemas, merges and fallbacks of the three keys;
- the `agent` and `llm` suites green, typecheck clean.

## Out of scope

- per-model values in the catalog — the mechanism only; values are written later from measurement;
- showing the trigger in the context panel;
- the excerpt-sizing formula in `ThreadNaming` (the same subtraction, but a different question — how much to read for a title, not when to compact);
- background compaction as the original does it (apply/rollback, races) — separate work.

## The open question

`input` on the OpenAI rows is a derivation of `context − output`, not a measured provider limit. If it is not the provider's actual refusal point, the `input` branch needs the same repair, and gpt-5.5 on openai-oauth then moves to 90% as well. A separate audit, not this work.
