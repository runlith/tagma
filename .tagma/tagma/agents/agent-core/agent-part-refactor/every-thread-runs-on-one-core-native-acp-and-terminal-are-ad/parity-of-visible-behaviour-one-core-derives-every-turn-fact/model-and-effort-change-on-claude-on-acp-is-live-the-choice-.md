---
id: 01a14cba-e095-7bcb-bb6f-60854010a731
title: "Model and effort change on Claude on ACP is live: the choice is written at once, the next turn configures the same session"
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a10a41-1b43-775c-a6ea-957a076a4c60
  - kind: relates
    to: 01a11c9a-6edb-7ed8-b517-60ae0f8d8726
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/facets.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/opening.ts
  - kind: file
    ref: packages/adapter-anthropic/src/runner/settings.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/sessions/model.ts
---
Goal: a model or effort change on Claude on `acp` behaves as on native: the choice is written at once, the live turn finishes on its old model, the next turn runs on the new one. The process does not restart, the turn is not interrupted. This changes the Claude runner's `modelMove` in [[0f8d8726]] from `relaunch` to `live`.

## Now

- **Native.** `HarnessMoves.move` answers `null` for a change inside the native road, and `ModelPreferences.setModelSettings` writes the choice into the row. The live run finishes on its own model ([[076a4c60]]).
- **Claude on `acp`.** `harnessMove` (`external-harnesses/sessions/model.ts`) refuses `thread-running` while a turn runs. Then `carryModelMove` stops the turn `by: 'model'` on the nearest checkpoint, but there is a checkpoint only at a Tagma tool-call result (`ThreadHosting.ts`, `execution.checkpoint`). Then:
  - If there was a Tagma call, the turn interrupts, the choice is written, the process is released (`release`), and the turn continues with a new process with resume.
  - If not, `RunExecution.stop` with `at: 'step'` waits for the turn end inside the call window (3 min at the operator) and answers `not-running` after the turn end, and the change passes after the turn. If the turn is longer than the window — `stopping`, then a `step-unreached` refusal.
  - At rest the change also releases the process, and the next turn pays for its start.
- **What the runner can do.** It already changes model and effort on a live session: `session/set_config_option` → `Settings.configure` → `setModel` and `applyFlagSettings({ effortLevel })` (`runner/claude/settings.ts`). But the driver sends `Configure` only when opening the session (`ProtocolOpening.configured`).

## Solution

- **`modelMove: live`** on the Claude runner profile ([[2121a95f]], [[0f8d8726]]). This profile's `Harness.move`:
  - validates the choice against the `claude-code` provider catalog, as native validates against its own;
  - writes the choice into the core row;
  - answers `{ from, to }`.

  It has no `thread-running` refusal and no `release`. So `carryModelMove` does not stop this change: the `running` branch never applies, as on native.
- **Applied at launch.** `launch` reads the choice from the thread row into `RunLaunch` ([[9116e494]]: the model choice is a core-row fact) and compares it against what the session is configured with. The holder is the protocol row field `configured`: the `currentValue` of each select option the session reported (on Claude — `model` and `effort`). `SessionReady` (open, fork, `_tagma/rewind` answer [[66a5c66e]]) replaces the field, `ConfigChanged` completes it. `settledFacet` writes it in the same record as the facet. The row is durable, so after a server restart `launch` compares the choice against the live session's configuration; a new process rewrites the field with its `SessionReady`. `null` means the configuration is unknown (a row carried by migration): the launch sends `Configure` for every profile option. When a value differs, the driver places `Configure` for each diverging option before `Prompt`; it never touches an option the session never reported. The "no new turn starts while a configuration request hangs" rule ([[e47bd3fc]]) holds the prompt until the answer. Launch and session opening share one owner — `ProtocolAlignment` (`protocol/alignment.ts`); `ProtocolOpening` only configures the mode.
- **An empty choice** means the same on every transport: the catalog default for the provider and that model's default rung, as on native. `resolvedAsked` (`birth/modelChoice.ts`) resolves it for both the process argv and the `Configure`, and the link's connection attributes context reads with the resolved choice. Otherwise the session would run on the CLI default while cache warmth read the choice as changed.
- **A launch refusal** is `refused(run, lasting)` with `model-unavailable`, and the words return ([[2121a95f]]). The catalog refuses (the choice is not served) or the agent itself (`session/set_config_option` returned an error): the agent's judgement replaced the "session offers the value" check on `options` at open, because the row keeps only current values. The process stays.
- A value the agent reports differently after `Configure` is never sent twice by the link (`Link.tried`): otherwise a normalizing agent would loop the configuration. A new link tries once again. A `Configure` whose answer is unknown after a restart (`uncertain`) does not hold the launch: its option is sent again.
- The choice the link attributes reads with after a restart comes from the live turn's row, not the thread's current choice: otherwise a mid-turn change would attribute its reads to the new model.
- **Mid-turn** nothing changes: Claude Code gets the new model from the next turn, as on native. Changing it inside the live turn (`setModel` between requests) is possible, but that would be behaviour native does not have.
- **A road change** (native ↔ `acp`, `acp` ↔ another adapter) stays a `HarnessMoves.handover` with no live run. Its turn carry via `carryModelMove` with the `model` reason stays; the move's stop places no `marker`, and there is no interruption row, as on native ([[45d13bf3]]).
- **Devin** follows the same road and is also `live`: launch sends it the same `Configure` it used to get at session open, and the shared `harnessMove` loses the `thread-running` refusal and `release` too. The terminal is `model-pinned`.

## What is removed

- the `thread-running` refusal and `release` in `harnessMove` (`sessions/model.ts`);
- the model choice from `store.asked` and `launchChoice` in `ProtocolOpening.configured`: the session configuration is decided by `launch` from the core row. Session opening configures it with the same comparison;
- `current` in the `ProtocolSessions` contract: only the `thread-running` refusal read it.

The `aligned_launch` migration carries protocol rows onto `configured`/`cut` and writes `modelMove: live` into the `acp` threads' capability snapshot.

## Acceptance criteria

The implementer proves:
- **Parity suite.** A model change and a separate effort change mid-turn on native and scripted `acp`:
  - `set_thread_model` answers at once;
  - the live turn ends `completed` with no interruption record;
  - the next prompt on `acp` is preceded by `session/set_config_option` of the same process, with no new `session/new` or `session/load`;
  - the next run carries the new model in the row and in context reading.
- **A change at rest** does not end the process.
- **Restart.** An effort change, then a server restart with a live runner: the next prompt is preceded by `set_config_option` for effort, and a repeated change to the same value sends nothing.
- **An option refusal** at launch returns the words and stops the wake.
