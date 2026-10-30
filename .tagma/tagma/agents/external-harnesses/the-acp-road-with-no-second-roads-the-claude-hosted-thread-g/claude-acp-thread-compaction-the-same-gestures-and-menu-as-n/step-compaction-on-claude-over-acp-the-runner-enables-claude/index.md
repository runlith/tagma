---
id: 01a118db-5778-76bc-8936-4436a9943509
title: "Step compaction on Claude over ACP: the runner enables Claude Code auto-compaction at the nearest step boundary, instructions travel via the PreCompact hook, Tagma alone picks the moment — manual and threshold alike"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a118cf-b972-77e1-a649-dbd8332f3ece
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/methods/compact.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/prompts.ts
  - kind: file
    ref: packages/adapter-anthropic/src/runner/compaction.ts
  - kind: file
    ref: packages/adapter-anthropic/src/runner/lifecycle.ts
---
## What the operator gets

`/compact` with Enter mid-turn on a Claude `acp` thread compacts context at the nearest step boundary: after the tool result and before the next model request. The turn resumes by itself, like a native thread. Tab compacts after the turn, as now. The Tagma threshold mid-turn also compacts on a step, and Tagma alone picks the compaction moment.

## Why

Claude Code holds `/compact` until the turn ends ([[e78fa33c]]). Interrupting the turn either drops the tool result and repeats the call, or leaves an interruption mark and an extra message in history ([[332f3ece]]). Claude Code's own auto-compaction fires before the model request inside the turn and resumes the turn without a trace. The `autoCompactEnabled` settings key enables and disables it, which the SDK's `applyFlagSettings` method flips live. Documented environment variables `CLAUDE_CODE_AUTO_COMPACT_WINDOW` and `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` set the threshold; per Claude Code docs the percent applies only with a window set. Claude Code takes instructions from the `PreCompact` hook output for both manual and automatic compaction. All of these are public means, so the runner assembles out of them compaction on a step with no turn break.

## How

**Runner** (`runner/claude`):

- Every query opens with `CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000` and `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=1` in the `claude` environment and with `autoCompactEnabled: false` and `idleCompaction: false` in settings. A 1000000 window is no smaller than any model's window, so `getContextUsage().maxTokens`, which `Settings` reads the window from, stays the model's window; a smaller window would understate it. Claude Code itself compacts neither mid-turn nor idle anymore.
- `_tagma/compact` takes `at: 'step' | 'end'`. `end` is as now: `/compact` runs as a separate session turn after the turn ends. `step` during a prompt: `Compaction` places the request and enables `autoCompactEnabled`. Claude Code compacts before the next model request, and the `PostCompact` hook disables the flag ahead of that request. `compact_boundary` and the recap leave via `_tagma/compacted`, as now. The `_tagma/compact` answer carries sizes and the recap with no spend of its own: compaction spend counts toward the turn's spend. `step` with no running prompt executes as `end`.
- If the turn ended with no next model request, the runner disables the flag and answers `_tagma/compact` with the “no step happened” refusal ahead of the prompt answer. The driver runs that request after the turn.
- Instructions travel one road: the `PreCompact` hook answers `systemMessage` with the standing request's instructions for both `end` and `step`, and `/compact` leaves with no arguments.
- Turn cancel (Esc) with a standing `step` disables the flag, and `_tagma/compact` answers with refusal -32800, as cancelled compaction answers now.
- Window overflow never ends a turn without compaction. What Claude Code does at the hard limit with auto-compaction off is decided by a live-Claude probe. If it compacts by itself, the runner accepts it as it now accepts foreign auto-compaction. If it ends the turn with an overflow error, the runner enables compaction and resumes the turn with the same prompt as a continuation message.

**Driver** (`protocol/`):

- `ProtocolCompactions` records the request in the inbox with the `at` it arrived with, and `compact_thread` answers `requested` with that `at`, like native.
- A `step` request during a prompt leaves for the agent at once if the profile declares step compaction (`vendors/claude/acp.ts`, the `compaction` field); otherwise it waits for the turn to end. The boundary is written in the current turn by the same `methods/compact.ts` declaration that now writes compaction Claude did itself; there is no separate run, and the turn keeps its classification.
- The inbox barrier holds like native: a steer arriving after the `step` request is never handed to the agent until the boundary or refusal arrives. A steer handed earlier Claude Code lays in before compaction — as in the probe.
- Automatic mid-turn compaction: on every measured `usage_update` ([[c7d3d8a2]]) the driver compares `used` against `CompactionPlanning.threshold` and on excess places a `step` request with `mode: automatic`. Between turns the threshold works as now.

The same change rewrites [[92391518|the ACP compaction note]], the “Compaction” item of [[d0810682|the runner notes]] and the `compact_thread` operation `grammar`.

## What proves it

The performer:

- the runner's `contract.test.ts` on fake `ClaudeSdk` and `Channel`: `step` during a prompt enables the flag, `compact_boundary` with `trigger: auto` answers the request and disables the flag; a turn with no next request answers with refusal ahead of the prompt; `PreCompact` answers with the standing request's instructions.
- driver system tests on the scripted agent (`testing/acpAgent.ts`) next to `protocolBarrier.stest.ts` and `protocolThreshold.stest.ts`: Enter mid-turn yields a boundary in the same turn and run; a post-request steer leaves after the boundary; a stepless turn compacts after the turn; Esc drops the request; the mid-turn threshold places `step`.
- live smoke in `protocolClaude.stest.ts`: step compaction in a tool turn — a boundary inside the turn, and the turn ends with an answer.
- an overflow probe on live Claude with auto-compaction off; the branch picked above follows its outcome.

Operator: in the app, `/compact` with Enter mid-way through a long Claude ACP turn places a boundary inside the turn, and the turn goes on; Tab compacts after the turn.
