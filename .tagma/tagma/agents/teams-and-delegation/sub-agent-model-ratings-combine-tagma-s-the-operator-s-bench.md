---
id: 01a18cb0-a4af-755c-aefc-f287afc032e7
title: Sub-agent model ratings combine Tagma's, the operator's, benchmark and measured sources, and Settings shows them as a list with a card per model
ord: 13
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9277306eedae
  - kind: relates
    to: 01a150bf-6fc7-74e5-b8df-48414dc6d09e
  - kind: relates
    to: 01a150e5-fbff-700e-98b9-7039ac67b9de
  - kind: relates
    to: 01a15101-ab43-7efc-a255-40e446e7ebcd
sources:
  - kind: file
    ref: packages/agent/src/collaboration/team.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/team/TeamSettings.svelte
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/settings.ts
  - kind: file
    ref: packages/llm/src/models/description.ts
---
## Why

The sub-agent list (`agent.models`) is the only thing an agent reads to choose a child's model, and today every number in it is one hand-typed opinion. Tagma ships ratings only for Anthropic and OpenAI rows; any other row starts at a fake 5/5/5/5 (`UNRATED` in `packages/agent/src/collaboration/team.ts`), so the agent picks blind until the operator fills the row. `favor` exists only because `spend` is not trusted: the agent receives `spend − favor`, two knobs for one value. Nothing tells a parent which model answers fast. And the Settings form is a matrix of about 200 dropdowns no newcomer can fill in meaningfully.

No source knows which model is best for a task: a benchmark measures one thing, the operator's impression is real but subjective, Tagma's own rating is a judgment, a measurement on this machine knows only speed. Each is partial, so the list combines them, shows where every number came from, and tells the agent where they disagree.

## Sources

Every row — a model on one reasoning rung, through one provider route — takes values 1–10 on the axes `open`, `depth`, `taste`, `ui`, `speed`, `spend` from up to four sources:

- **Tagma** — the adapter's shipped `TeamRating`, as now, gaining an optional `speed`. Every built-in adapter with text models ships ratings for its current main models, so a newcomer on any built-in provider starts from a judgment, not from 5s.
- **Yours** — the operator's impression: the numbers his `agent.models` edits set. Same fields as today plus `speed`; `favor` is gone.
- **Benchmarks** — public measurements through a benchmark adapter. The first adapter reads the Artificial Analysis free API (`/api/v2/language/models/free`) with the operator's own key: Intelligence Index → `depth`, median output tokens per second → `speed`, cost per Index task → `spend`. Its coding and agentic indexes are null on the free tier and per-benchmark scores are paid, so they are not used. The API has no reasoning-effort field — a variant shows only in the display name — so the adapter maps rows to its entries itself, and a row it cannot map has no benchmark values. Its `spend` applies only to rows whose account is an API key: on a subscription, money per token is not what the work costs.
- **Measured** — Tagma's own records on this machine: every native model call is already a `model-call` activity with provider, model, rung, start, end and usage, so output tokens per second per row is a fact Tagma holds. A row gets a measured `speed` after 20 successful calls, from the median of its last 200 within 30 days. This is the speed on the route the user actually runs (a CLI sign-in and the API differ, so does a Fast switch), which no public benchmark sees.

Mapping to 1–10: a benchmark or measured value is scaled against the best value the same source has among the models Tagma can offer this user (connected providers' text models on every rung) — `10 × value / best`, rounded, at least 1; for `spend` the most expensive is 10. "10 is the best available now" stays the scale of every source.

`taste`, `ui` and `open` have no honest public measure: they come from Tagma and the operator only, and the card says so.

## Combining

Per axis, the combined value is the weighted mean of the sources present, rounded. Weights are one machine setting, `agent.modelSources`, with words Off, Low, Normal, High (0–3) per source; defaults: Tagma Normal, Benchmarks Normal, Measured High, Yours High. Off leaves a source out entirely. Where the present sources differ by 3 or more on an axis, the row also carries their spread. An axis no source rates is `unrated`, never a made-up middle.

## What the agent receives

The `spawn_agent.model` description keeps one line per enabled row, now `open 8, depth 7 (5–9), taste 9, ui 9, speed 4, spend 7` with limits as today; `(a–b)` appears only where sources disagree. The instruction above the lines says, in one sentence each: ratings combine Tagma's, the operator's, benchmark and measured sources; a spread means they disagree and `unrated` means unknown; take the row meeting every need with the lowest spend, and when you will wait on the child's answer, the fastest among those. `only`, `not`, operator-only and a model the operator named keep their force.

Benchmark and measured values enter the delivered list as a snapshot taken at most once a day (and when a source is connected, disconnected or reweighted), so a working thread is told of a real change by the sub-agent team line (46e7ebcd) and never of per-call jitter.

## Settings screen

The matrix goes. "Models for sub-agents" becomes a list read at a glance with a card per row.

- **Groups** stay by provider route, with the whole-provider switch and the quota gauge as in the Team menu.
- **A row** is: the On check; the model name with its rung after it, dimmed and indented, no `·`; six crests (`TileMeter`, 10 tiles) for Open, Depth, Taste, UI, Speed, Spend under one short column header each — a measure is a fill; a spread shows as dimmed tiles between its ends; an unrated axis is an empty track; then `only`/`not` limits as dim words. The row body opens its card; the check only toggles.
- **The card** opens inline under its row, one at a time. One line per axis: its name, the combined crest, then each source's value told apart by tone — "Tagma 8", "Artificial Analysis 10, Index 58", "Measured 81 tok/s over 140 calls", "Yours" with a stepper and a clear. Below: Only and Not (the existing `WorkPicker`), Note, Only on your word, then Reset to Tagma's (drops your impressions on this row) and Remove.
- **How ratings combine** — a group under the list: the four sources, each with Off / Low / Normal / High as word buttons; the Artificial Analysis line connects with a key field and then shows when it last read and, after a failed read, one `Callout` naming the failure while the last good reading stays in use.
- **Add** keeps the catalog search; with benchmarks connected, each candidate shows its Index and tokens per second.

The Team menu in the composer does not change.

## Architecture

- **Combining** stays one pure function in agent core: `teamOf` (`packages/agent/src/collaboration/team.ts`) takes the shipped ratings, the edits, the readings and the weights, and answers each row's combined values, spreads and per-source values; `rowWords` and `modelChoiceWords` print the new line. The reading shape and the axis list are declared there, the lowest module using them.
- **The benchmark contract** stands in the model wire kit beside `TeamRating` (`packages/llm/src/models/description.ts`): a source names itself, says it needs a key, reads its entries and maps a row key to raw values. The Artificial Analysis adapter is its own package implementing it whole; composition connects it. The core knows no source by name.
- **Readings** belong to one new server module under Models: it keeps the daily benchmark read (at start when the last read is older than a day, then daily, and on key change), its last good result across restarts, the measured aggregates, and the daily snapshot. Measured speed is kept incrementally as each `model-call` activity ends — never by rescanning activity history. The key is a Tagma secret, never a setting value. Threads read the snapshot through a port this module fills.
- **Settings:** `agent.models` edits keep their shape minus `favor`, plus `speed`; a stored edit carrying `favor` lands once as `spend − favor` (clamped 1–10) and no `favor` remains. `agent.modelSources` is new, machine scope. Both descriptions in `apps/tagma/server/src/threads/contract/wire/settings.ts` describe the new meaning.
- **App:** `TeamSettings.svelte` is rebuilt from existing parts — `TileMeter` (gaining the dimmed spread), `Stepper`, `Segmented`, `WorkPicker`, the provider heading and usage marks.

## Not in this spec

Measured quota spend per child run stays idea 4dc6d09e; this design takes it later as one more source with no change to the combining. Quality signals from outcomes (review findings, failed or rewound children) are not a source here.

## Acceptance criteria

- A row's delivered line carries combined values, `speed`, a spread only where sources differ by 3 or more, `unrated` where nothing rates the axis; no line carries `favor`.
- With one source set to Off, its values change no combined value; with only Yours on, the line equals the operator's numbers.
- With an Artificial Analysis key, mapped rows show the Index, tokens per second and (API-key rows only) cost per task with the read date; without a key nothing is fetched; reads happen at most once a day; a failed read keeps the last good reading and the section names the failure.
- After 20 successful calls on a row, its card shows measured tokens per second; the aggregate updates per call without reading history.
- A working thread receives a team line when a snapshot changes a delivered value, and none on calls that only move raw measurements.
- A stored edit with `favor` reads back as the adjusted `spend`, and no `favor` field is written again.
- Every built-in adapter with text models ships ratings for its main models.
- Settings shows the list and card; no `·` separators; the token rule passes.
- Typecheck and the affected packages' tests pass; minimal contract tests: combining (weights, Off, spread, unrated), the adapter's parse and mapping over a recorded free-tier answer, the incremental measured aggregate, the snapshot cadence against the team line.

The operator's look at the screen is not a completion condition.
