---
id: 01a111ad-1d14-7079-ad84-43a6a5fd6a10
title: "Activity: one record of everything the product does, answering \"who, why, with which model, on which input, with which effect\" over the last day"
ord: 16
tags: ["spec"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/activity
  - kind: dir
    ref: apps/tagma/server/src/native-harness/evidence
  - kind: dir
    ref: packages/activity
---
Everything the product does over a thread — an agent run, an ACP turn, a model call, a side call (title, recap, compaction), a completion settlement — leaves one **activity** record, by which the last day quickly answers: who, when, on which trigger, with which model and why it, on which input, with which output, effect, and token usage. One mechanism for everything. Effect-span tracing (`@runlith/performance`) stays a separate system about process performance and links to activity through the span's already-existing `run_id` column.

## Why

Two independent ratings of 2026-10-06 — our own ~5/10 and the obs-architect agent's 4.5/10 (report `scratch/01a1119a-5b2b-7b5b-b18b-d7636bd8bc25/observability-assessment.md`; adversarial review of the spec — `scratch/01a111ad-5497-78bf-9cbf-dbfc54414799/activity-spec-review.md`; figures from this machine — sample):

- **Lifecycle.** `TraceBundles` removes a bundle from open only on `run-ended`; `settlement-*` arrive later and reopen it (2221 of 2221 bundles); `retain()` skips open ones — after a server start nothing is evicted, the `traces.maxBytes` limit holds only through restarts; every reopen re-reads the whole log on the main flow.
- **Identity is runId only.** Side calls invent a `runId` or are appended to a finished run; ACP turns write nothing (16 of 17 per day); the model choice is recorded nowhere.
- **One model call lives in five places** with no shared id; six hand-written started/ended pairs; an interruption leaves only "started"; one-shot calls (`ModelRequests.runOneShot`, `summaryStrategy`) lose context and write to `untraced`.
- **Reading.** No entry by time window; `select:'trace'` folds every run twice on the main flow with no read ceiling.
- **Layers and names.** The lower kit holds a closed union of domain facts; the store decides the meaning of run completion; the server duplicates the `RunTrace` schema; the store mounts the `performance` module; there is a `schemaVersion` and an old-shape reader; "trace" names two systems.

## 1. Model

- The **`@runlith/activity`** package replaces `@runlith/trace` and `@runlith/trace-bundle`. Neutral entries (envelope, port, combinator, the `model-call` kind) load only `effect` — `llm` and `agent` take them; node entries (store, body writing, reading) — only the server. Module cards merge through `set_module`; rules aee8c068 (the drain does not throw into the observed work) and ebb5b50e (a page is read by replaying the observed prefix) move to the new module.
- **Activity** is an envelope: `id`, `parent`, `thread`, `run` (optional), `kind`, `actor`, `trigger`, kind attributes; `opened` / `noted` / `ended` facts with an outcome (`ok` / `refused` / `failed` / `cancelled` / `orphaned`).
- **Kinds.** The kit declares one built-in kind — `model-call` (provider, model, rung, account, usage), because the index needs its columns. The other kinds (`run`, `turn`, `title`, `recap`, `compaction`, `settlement`, `tool-call`, …) are typed constants in their owning module's contract, attributes stored as JSON; there is no runtime registry, the core does not enumerate kinds.
- **Names.** The current `AgentActivity {phase}`, `ThreadActivityRecord`, `ThreadListRow.activity` and kin (~50 files) are renamed to `phase` in the same change — the word `activity` gets one meaning. Bodies are **body**, reading is **fold**; `by` is deleted; "trace" and "span" stay only with Effect tracing.

### Identity

- Id is uuidv7, issued by the combinator at `opened`.
- `parent` is the causal link; a child may open after the parent finished (recap, title, completion settlement, `agent-result` arrive later than the run and get their own activity with `parent` = the run).
- A run is one kind-`run` activity per episode, `run` = the `thread_run` row id; an ACP turn is the same, its id already the run row's id (note e47bd3fc).
- Transport attempts are numbered `noted` inside `model-call`; this closes task 0fcb2de4.
- At store start, activities left open by the previous process close with outcome `orphaned`.

### Actor and trigger

- **Actor:** `operator` | thread (id) | CLI session (id) | a named server component (`recap-schedule`, `title-hook`, …).
- **Trigger:** `{ kind, refs: readonly string[] }` plus the causing activity's id; one cause carries one id. A run's trigger is the inbox items delivered at its start (`deliveredToRunId` is already recorded in inbox); `start_key` is an idempotence key, not a trigger.
- The **`ActivityCause`** port: `invocation` fills it for an operation call; an activity opened inside the call takes actor and trigger from it. Operations themselves do not become activities — that is their owner's separate task.

### Combinator

- `activity(kind, attrs)(effect)` in Effect and Stream shapes: `opened` before the work, `ended` on `Effect.onExit` always — success, typed refusal, failure, interruption. `note(fact)` inside. Outcome and final attributes (usage, effect) are set from the result.
- **Only `ModelRequests` opens `model-call`** (`prepared`, `:61-125`) — every model call goes through it, including aside and compaction. Callers open only their target kind (`title`, `recap`, `compaction`), and `model-call` becomes its child.
- One-shot calls become effectful (no `Effect.runPromise` mid-chain), so port context is not lost. All six hand-written pairs move to the combinator.

## 2. Storage

- One store: `activity.sqlite` in the `@runlith/sqlite-process` process, drizzle migrations; activities and their facts are rows indexed by `(project, at)`, `(thread, at)`, `(parent)`. Reading and group/sum are SQL in the store process; the main flow executes no SQL.
- **Bodies** are files in hourly buckets. A request body is what actually went to the provider (after lowering), a delta to the same thread's previous body (a chain by thread, not by run), so a warm title or recap stores only the instruction. Bodies over the ceiling are `noted` as dropped with their size.
- **Fact recording on the main flow** is O(1): appending to a batch; the batch goes to the store process. No hold, file append, or span per fact.
- **Retention:** `activity.keepHours` (default 24) for rows; `activity.bodiesMaxBytes` — a ceiling for bodies only, a ceiling cut is recorded as a loss fact with its size. Cleanup is run by the store owner's periodic pass on the server, started at its launch (rule a00f91b0).
- **Old data.** `~/.tagma/traces` is deleted at the new build's first start: history older than a day is unneeded, there is no old-shape reader. The `traces.maxBytes` setting is deleted.

## 3. Reading

- One door — `read_thread`:
  - the `activity` source (activities and their facts; envelope fields, kind, actor, trigger, model, outcome, usage; body expansion through `read_thread_record`);
  - the "threads with activity in `since/until`" selection — the "last 5 minutes for the project" question goes by the `(project, at)` index;
  - the read ceiling applies in the store process.
- The `trace` source is replaced by `activity`; the `read_thread_trace` operation, the `tagma thread trace` verb, and voice trace reading read the same source or are deleted together with the old — in one change. `read_activity` is not introduced.
- The `steps` and `measurements` journal sources stay (different grain and the journal's eternal horizon); their records carry the `model-call` activity id.
- `read_performance` finds run spans by the existing `run_id`; `traceGroup` becomes a span attribute, `agent` stops depending on `@runlith/performance`.

## 4. Ownership

- A new server module `activity/` owns mounting the store, settings, the read source, and the `ActivityCause` wiring. The `performance` module no longer mounts the store; the trace source leaves `native-harness/evidence`.
- Untouched: `@runlith/performance`, the thread journal, `@runlith/held`.

## 5. Titles and recap

On the model above, with no mechanism of their own:

- `ThreadNaming` and `RecapSchedule` open the `title` and `recap` kinds through the port; `parent` is the thread and the source run (warm path, recap); the `model-call` inside is a child.
- Trigger: a hook (run + operator input id), a `generate_thread_title` call (actor through `ActivityCause`), recap schedule (run and deadline).
- The `model-chosen` fact from the road's choice: the chosen one, the rejected ones with causes, why the warm snapshot was not taken. For recap the model is the run's warm binding, recorded the same way.
- The CLI road (`claude -p`) is a `noted` with the CLI command and model; it has no `model-call`, usage is as the CLI reports, else absent.
- Input body: an excerpt or the instruction with the covered journal position; output body is the answer.
- Effect: `nameTitle` returns an outcome instead of boolean — recorded / same text / overtaken; recap — published; a recap skip is an outcome, not `logDebug`.

## Order

1. **At once, separately:** bundle closing on the run lifecycle (no reopening), deleting `schemaVersion` and `namedDrop`. Fixes store growth ahead of the main work.
2. **One change:** the package, store, port, combinator, `model-call` in `ModelRequests`, all producers, all readers, renaming `activity` → `phase` at the old owners, deleting `trace`/`trace-bundle` and `~/.tagma/traces`.
3. **Part 5**, run triggers, ACP turns, and host tool calls.
4. **Owners' separate tasks:** operations as activities, `StallRecords`, speech, workflows, the `evidence-reads` and `operatorResults` boundaries, splitting `ThreadEvidence` and removing `Pick` slices, one host-read worker.

Task bd12712a closes as absorbed by this work, 0fcb2de4 as fixed by the identity model.

## Acceptance

- **unit:** the combinator writes `ended` with the right outcome on success, refusal, failure, and interruption.
- **integration:** the store with TestClock holds `keepHours` rows and under-ceiling bodies, closes previous-process-open ones as `orphaned`; through `naming.itest.ts` — a fresh, warm, and interrupted title read from `read_thread` source `activity` with trigger, `model-chosen`, bodies, and effect; recap the same.
- **system:** one ACP turn yields one activity `run` (`protocolRuns.stest.ts`).
- **measurement:** a day-window project read holds the main flow no longer than 50 ms; fact recording on the main flow is O(1) with no file operations.
- **live check:** after a restart the agent itself triggers title generation and answers from `read_thread` who, when, by which trigger, with which model and why, on which input, with which output and effect — for a native, ACP, and terminal thread, for recap, and for an interrupted attempt. Still unproved: no such post-update live check was established by the completed tasks; this is an agent verification, not an operator-glance condition.
