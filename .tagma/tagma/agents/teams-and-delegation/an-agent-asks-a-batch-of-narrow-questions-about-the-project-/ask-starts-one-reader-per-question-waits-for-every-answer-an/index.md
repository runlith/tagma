---
id: 01a1a889-5a08-79a0-96d3-585a6ed28265
title: "`ask` starts one reader per question, waits for every answer and returns them as the result of the one call"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927a1d3e398d
---
**Input.** `questions` — one line each, a bounded fan-out per call whose bound and reason stand in the input schema; `agent` — a definition id, default from the setting `agent.ask`, else the built-in `reader`; the place — project and checkout, default the caller's.

**Birth.** One reader per question, born like a workflow member (`ThreadWorkflowMembers.startMember`): the spawn tree with `reportDelivery: 'collect'` and a `bornOf` naming the call, under the caller's thread, under the same delegation and offered-type law as any child. Model: the definition's; else the caller provider's `lightTextModel`, at the definition's rung when it names only a rung; else the caller's model.

**Wait.** The call waits on each reader's fact — its last message, or the diagnosis a failed run reports — through the same collection workflow steps use. It has no deadline of its own: the readers' budgets bound them, and a wait ends on a fact, never on a clock. Stopping the caller's run stops its readers.

**Answer.** A reader's answer is the last message of its run, collected as its report. The reader writes in it the paths and blocks the answer rests on and what it could not establish; no flag or field carries completeness, so a reader ending in text is never reminded or asked to repeat its answer.

**Result.** One entry per question, in question order: `answered` with the reader's last message, or `failed` with the diagnosis of a run that failed, was cut or stopped, or left no report — and the reader's thread id; rendered compact for the caller's context.

**Visibility.** Readers are recorded threads, not team members: they stay out of the thread list, the team tree, its counters and `list_agents`. The call's card in the caller's feed shows each question with its state and answer and opens its reader's thread. Readers are archived when the call returns.

**Caller guidance.** The tool description says when to ask — facts about how a part is arranged, where something lives, what owns it, what a contract says, independent questions batched in one call — and when not: design, judgement, changes. It tells the caller to verify only what its decision rests on. The Collaboration voice, which tells an agent to do the work itself and start a child only for a named gain, names `ask` as the way for such lookups, so the two never contradict. No text names a model.

**Reach.** The native tool, and the operation of the same name for foreign-CLI threads through Tagma MCP, run by the same collaboration core plane.

**Architecture** (read in the tagma checkout, 2026-11-05).
- *Verb.* `ask` is a verb of `ThreadVerbs` (`collaboration/ThreadPlaneAccess.ts`), built in `verbsOf` of `ThreadPlanes.ts` beside `spawn`: one `tree.spawn` per question with `reportDelivery: 'collect'`, `bornOf` from the caller's run and step, `requestId` from the call key and the question's index; then the envelope access's `collect` (`collectReports` in `arrivals.ts`) over the readers. `collectReports` already ends on facts — every reader reported, or none is still working and none owes the caller a report — so its deadline is set beyond any reader's budget and never decides. Births run one after another, as workflow members' do; the readers then work in parallel.
- *Model.* `birthModel` (`modelChoice.ts`) is asked with the definition's model when it names a provider or a model; otherwise with the caller provider's `lightTextModel`, carrying the definition's rung when it names one (`ModelCatalog.named(provider).lightTextModel`); otherwise nothing, so the caller's model stands. A caller whose model Tagma does not host (a CLI thread on a provider with no native hosting) gets no light model; its readers then refuse with the host's `model-unavailable` unless the definition names a model.
- *Report.* A collected report is the run's last message alone (`completionReport` in `reportTexts.ts`), so the reader's text reaches the caller without a wrapper.
- *Entries.* A report from a run that completed is `answered` with its text; a run that failed, was cut or aborted, or no report at all, is `failed` with the ending or the diagnosis.
- *Stop.* Interrupting the call stops every reader still running (`acting.stop`).
- *Mark and archive.* `ThreadBornOf` (`protocol/birth.ts`, stored as JSON in `thread_record.born_of`, so no migration) gains an optional mark that the birth was an `ask`. A call with no run (an operation) marks with the call key as `by`. The thread list selection (`select.ts` `selected` and `liveFamilyOf`, and `announce` in `threadList.ts`) and `list_agents` (`pageTeam` in `native-harness/rows/threadRow.ts`) skip marked threads, so the team tree and counters, built from list rows, never see them. Archiving after the call and the default reader (`agent.ask`, fallback `reader`) go through `CollaborationConfig.readers`, a port the collaboration core declares and `threads/harness/engine.ts` fills over the thread list.
- *Operation.* `ask` joins `COLLABORATION_OPERATIONS` (`threads/contract/wire/operations/collaboration.ts`) with its pair in `threads/operations/collaboration.ts`, run by the same plane as the tool.

**Acceptance.**
- Through the native tool with a scripted model: three questions give one result with three entries in question order; the caller's run receives no report turn; the readers are absent from the thread list and archived after the call.
- One reader's provider failure gives that entry `failed` with its diagnosis while the others answer.
- Stopping the caller's run leaves no reader running.
- The operation through Tagma MCP from a foreign-CLI caller returns the same shape.
- A reader on Claude Code that ends in text gets no closing reminder, and its text is its entry's answer.
- The feed card lists each question's state and answer and opens its reader's thread.
