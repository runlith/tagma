---
id: 01a113ff-0d62-74ec-ae7c-e9144acce69d
title: "The Claude runner: prompt snapshot via a documented SDK option, undocumented calls in one adapter, the session split by subject, contract tests on a fake SDK"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a108ea-e217-7ba4-b3f5-b5266c4c410f
sources:
  - kind: dir
    ref: apps/tagma/server/src/external-harnesses/runner/claude-code
---
## What the operator gets

Updating `claude` on the machine no longer silently switches off the fresh prompt on resume. Runner behavior is verified on every test run, with no Claude login and no network.

## Now

- **The prompt snapshot is pinned to a version.** The runner passes the internal CLI flag `system-prompt-snapshot off` only to the `claude` version it was measured on (`SNAPSHOT_FLAG_VERSION` in `run.ts`). On any other version it logs a stderr warning, and the resumed session keeps the prompt it started with. On 2026-10-07 exactly that happened at the 2.1.289 → 2.1.292 move: the pinning had to be updated by hand.
- **Undocumented SDK calls are scattered** across `session.ts` with type casts:
  - `askSideQuestion` and `cancelAsyncMessage` — absent from SDK 0.3.292 types;
  - `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` — present in types but marked experimental.
- **`session.ts` is 583 lines against the 650 ceiling.** `ClaudeSession` holds the query life (open, reopen, generations, read loop, death), turn and spend accounting, steer, cancel, compaction, aside and settings.
- **No session-behavior tests exist without live Claude.** Only event translation has a unit test (`translate.test.ts`). Everything else is verified by system tests against installed `claude` and the model (`protocolClaude*.stest.ts`, `protocolCompaction.stest.ts`, `protocolAskUser.stest.ts`). They need login and network, cost money and never deterministically pass. Aside has no tests at all.

## Goal

**1. The prompt snapshot is a documented option.** `systemPrompt: { type: 'custom', prompt, snapshot: false }` is an SDK 0.3.292 `Options` option. Per its docs, it is accepted with no effect where prompt recording is off.

Deleted:

- `SNAPSHOT_FLAG_VERSION`;
- `extraArgs['system-prompt-snapshot']`;
- `RunnerSetup.snapshot`;
- the stderr warning.

The runner still reads the `claude` version: it goes into the assembled session file.

**2. One SDK adapter.** Everything the runner calls on `Query` beyond the documented surface lives in one `runner/claude` file with narrow declared types: side question, session spend, recall of a placed message. A missing method yields a typed refusal, as now — never a silent success. The live smoke calls `_tagma/aside`, so an SDK bump removing the method fails the test, not the user's turn.

**3. The session by subject.** `ClaudeSession` splits into owners:

- query life: open, reopen onto a new prompt, close, generations, read loop, death;
- turn: prompt, steer echo, cancel with recall of unhanded words, result and spend accounting;
- compaction;
- aside;
- model and effort settings.

`ClaudeSession` assembles them and answers ACP handlers with the same contract as now ([[d0810682|Claude runner]]).

**4. Contract tests on a fake SDK.** A fake `ClaudeSdk` returns from `query()` a `Query` that emits SDK messages per script. Tests go through the agent's or session's public handlers and verify the outcome:

- prompt answers with a `stopReason`, the turn's spend as the cumulative-minus-`_meta['tagma/turn']` difference;
- steer answers `injected`, `startedNewTurn` or `promptRequired`;
- cancel yields `cancelled` and refuses unhanded steers with code -32800;
- compact answers success, failure or cancel and carries spend in `data`;
- a run prompt that changed at turn open reopens the query on the same session before words are sent;
- a mid-turn fork finds the prompt's uuid;
- aside answers with text and spend, and `methodNotFound` without the method.

This is the unit layer: no process, no disk ([[ad3c527d|unit-test rule]]). Session file assembly (`transcript.ts`, writes to disk) stays in its integration test.

**5. Live tests are smoke.** One file stays against real `claude`: a turn with a Tagma tool, steer, aside and compaction. The remaining `protocolClaude*.stest.ts` cases move into runner (item 4) and driver ([[16a4c8ac|driver]]) contract tests.

## Verification

The performer proves:

- the item-4 contract tests pass;
- the live smoke on `claude` 2.1.292 passes; a resumed session after a run prompt change answers per the new prompt;
- code search finds no `SNAPSHOT_FLAG_VERSION` or `system-prompt-snapshot`; undocumented `Query` methods are named only in the adapter file.

The operator checks: after a `claude` update the Claude `acp` thread resumes the session, and the changed agent prompt applies from the next turn.

Notes rewritten by the same change: [[d0810682|Claude runner]] (prompt snapshot), [[f3949b43|aside via session]] (SDK adapter).
