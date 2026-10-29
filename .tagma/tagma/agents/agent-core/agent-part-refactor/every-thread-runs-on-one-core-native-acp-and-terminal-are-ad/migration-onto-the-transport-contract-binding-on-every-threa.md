---
id: 01a11c9a-6edb-7ed8-b517-60b2a63eba68
title: "Migration onto the transport contract: binding on every thread, terminal sessions as runs, vendor questions as Questions, rollout-copy steps"
ord: 6
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/rollout.ts
  - kind: file
    ref: apps/tagma/server/src/threads/store/harnessFacet.ts
---
Goal: stored sessions, links, and harness rows cross once into the contract shape. After the crossing, reading code knows one shape ([[acb620dd]]). Work in flight — a running turn, an open question, a owed report, an unacknowledged word — is never lost and never repeated.

Each root cut migrates what it changes in its own database migration (`drizzle/`) with a data step. A migration is a database write; it never calls the core. So it writes core rows in their current shape: run, ending, outbox position, question.

## Cut 1: binding and `acp`

- **Thread core row** gains `transport` (`TransportBinding`) and `capabilities` columns:
  - native: `{ adapter: 'native', profile: null }` and the current `NATIVE_CAPABILITIES`;
  - `acp`: `{ adapter: 'acp', profile: facet.name }`, capabilities from the vendor profile and `facet.proves`.
- A thread's model choice on `acp` moves from `facet.asked` into the core row (profile provider, model, reasoning) instead of `provider: 'external'`.
- **Agent.** The `facet.hosts` value becomes the binding's `agent` field. `agentId` stays `harness`.
- The `acp` **facet** loses `transport`, `hosts`, `proves`, and `asked`: they live in the binding, snapshot, and core row. `session.heartbeatAt` and `ownerId` move into indexed resource-lease columns of the adapter row; the owner is `ThreadOwner.id`.
- **Protocol row with `ending`** — an end the driver recorded but the ledger has not closed yet:
  - when the run is still `running`, the step closes it with that end, writes the ending, and seeds the notification in the outbox (`pending`);
  - when the run is already terminal, `ending` is simply dropped.

  After the step there is no `ending` field.
- Replay keys, inbox fates, `protocol_turn`, and the row's hanging requests never change.

## Cut 2: vendor questions

- `facet.question` with `source: 'protocol'` and the protocol row's hanging permission-request queue become `Questions` entries with the same id, the vendor request id as key, and the answer route to the `acp` adapter. The run gains the `awaiting` stage when it lacks one.
- The step docks with the questions migration [[4946aca5]]: that one carries `hook` and `consent`, this one `protocol`. The `facet.question` slot goes away with the last source, in cut 3.

## Cut 3: terminal

- **Core row and journal.** Every thread whose facet is on `terminal` gains a core row with a `{ adapter: 'terminal', profile: <vendor> }` binding, profile capabilities, and an empty journal.
  - Past turns never move into the journal: Tagma has no entries for them. This is a visible change: a terminal thread's feed starts at the migration.
  - Row synthesis via LEFT JOIN (`native-harness/row.ts`) and the `externalLog` refusal go away.
- **A session becomes a run** by its state:

| Session | Observed work | What the step writes |
|---|---|---|
| `starting`, `running`, `stopping`, `uncertain` | `working` or `waiting` (`observed`) | a `running` run with the session id, handed over (`handedOverAt`) so the new server adopts it with no resume count; the vendor turn `work.turnId` maps onto that run in the adapter row; a standing question → `Questions` and the `awaiting` stage |
| same | `idle` or `unknown` | no run; the resource stands |
| `ended`, the thread's last session | — | a terminal run with the session id, outcome, time, and cause; the outbox notification is `delivered` when `reported`, else `pending`, and then the owed report goes exactly once |

  A run id equals the session id, so inbox items with `deliveredToRunId = session.id`, `thread_seen.runId`, and report-envelope ids stay correct. Items delivered to earlier sessions already got their `sessionEnded` report and never change.
- **Stop-hook claim** (`harness_delivery_claim`) with no `acknowledge` becomes an unacknowledged delivery to that session's run, with a read deadline counted from migration time. Words the CLI may have read are never repeated, and unread ones close on the deadline with one report. The table goes away.
- **Guidance accounting.** Hook `touchState` files in the temp folder never move: after migration the law is re-delivered on first touch of the path, once each ([[2121a95f]], "What is told to the agent").
- **Questions** in `facet.question` with `source: 'hook'` and `'screen'` become `Questions` entries as in cut 2. The slot goes away.
- The **`terminal` facet** loses:
  - `transport`, `hosts`, `proves`, `question`;
  - `session.outcome`, `failure`, `finishedAt`, `reported`;
  - `observation.work`, `turns`, and `receipts` as life.

  What stays: process (id, execution state, argv, cwd, pid, `origin`), vendor session key, root binding, model observation, diagnostics, and held `held` replies before root binding. The lease is indexed columns, as on `acp`.
- **Spend.** A terminal thread's spend is its runs' spend. `harnessSpend` reads runs, like native `spentBySpawnRoot`; earlier sums move into their sessions' runs.
- **Old facet-read shapes in the database go away** with this step, because it rewrites every row:
  - `legacyRuns`, `legacyFailure`, `nativeSelection` columns and the `LegacyRun` type (`threads/store/harnessFacet.ts`);
  - `legacyModel` and `why: 'legacy-row'` (`externalSession.ts:81-109`);
  - decode defaults (`withDecodingDefaultKey` for `hosts`, `origin`, `source`, `kind`, `options`, `frame`, `observation`) — the step writes every field explicitly;
  - the `takeUnclaimed` branch (`turns/deliveries.ts:39`) goes with the file.

## Copies in rollout files

A rollout file is a thread copy outside the database: an exported or carried thread returns to the database from it (`threads/journal/rolloutMeta.ts`, `importRolloutMeta`). Today old files are repaired on import as `transported` and `legacy` (`external-harnesses/rollout.ts:48-84`, `native-harness/rollout.ts`).

There are many files, and each passes the steps when it appears — the same exception for stored data with many copies as `drizzle/` and the graph steps ([[acb620dd]]):
- Rollout import passes ordered shape steps. Each step changes only the old shape it finds, and reading code knows only the current one.
- Today's `transported`, `legacySession`, and hook `legacy` become the first such steps.
- This work adds its cuts' steps inside the parts the import writes (`record`, `mandate`, `native`, `external`, `opener`): binding, capabilities, model choice, and `binding.agent` from the old facet; the `native` part for a terminal thread that lacks one; the facet in adapter-row shape.
- A rollout copy is a snapshot, not a live process. So the step brings every session in it to rest: no process stands, the step writes no runs and no questions, and never revives a running turn. A thread from such a copy arrives at rest, with no past-session end and no report it may have owed — the parent request stays open, and the parent sees the thread.

## Cut 4

Changes no stored shapes: it removes reads.

## Acceptance criteria

The performer proves it with a migration test on both storage adapters where they exist, on a database with unfinished work:
- an `acp` thread mid-turn, an `acp` thread with an `ending` before the ledger closed it, an `acp` thread with two hanging permission requests;
- a terminal thread mid-turn with a `hook` question, a terminal thread with `unknown`, a terminal thread with a finished unreported session and an owed parent request, a terminal thread with an unclosed Stop-hook claim;
- a native thread with a parked run.

Threads at rest, exported to old-shape rollout files before migration and imported after, yield the same core row, binding, capabilities, model choice, and adapter row as the database migration. A rollout copy of a mid-turn thread imports at rest.

After migration:
- `RunStatus`, attention, and the list row of every thread match, except the named changes: `unknown` → `idle`, the terminal has no past feed;
- every question answers under the same id, and the answer reaches the vendor;
- the owed report goes exactly once;
- unacknowledged words never repeat;
- the running turn is adopted after the server starts;
- `rg` and schemas: no old facet fields, no `harness_delivery_claim` table, no old-shape readers.
