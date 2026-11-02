---
id: 01a15113-e4c9-763e-bcc6-16a807c34834
title: "One turn's calls travel in the order their declared resources require: dependents in call order, independents in parallel, the undeclared on a safe default, on native and hosted identically"
ord: 71
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a118eb-3e7e-7085-8f2e-2cd49bc6e931
  - kind: relates
    to: 01a126bc-553e-7e90-b4f0-d69d00a81b23
  - kind: relates
    to: 01a14ad8-c204-74cf-8dba-efe8621f79f0
  - kind: relates
    to: 01a15113-e4c9-763e-bcc6-16a942061194
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/skills/artifacts.ts
  - kind: file
    ref: packages/agent/src/agent/door/ToolExecution.ts
  - kind: file
    ref: packages/agent/src/agent/tool.ts
  - kind: file
    ref: packages/agent/src/agent/turn/tools.ts
  - kind: file
    ref: packages/agent/src/thread/run/hostedOrder.ts
---
One turn's calls travel in the order their declared resources require: dependents in call order, independents in parallel, the undeclared on a safe default — on native and hosted identically.

Goal: one model turn's calls yield the same result as executing one by one in call order, while independent ones among them still travel in parallel. Every tool declares what it reads and what it writes; a tool without a declaration receives a safe default. Correctness does not depend on whether the model splits dependent calls across turns: any model sometimes puts them in one turn.

## What happened

Thread 01a125fe-9260-7644-9a64-589c9bc19e19, turn #25366 (2026-10-18). One model answer: `write` (`fromFile`, target `review-menu/index.html`), then `publish_artifact` of the same target.
- Both started at 21:46:35.193 and .194 UTC (`execution.started` of records #25370 and #25369). `write` ran 69 ms, `publish_artifact` 53 ms. Both answered success.
- Version `20261018T214635195Z` is 27,483 bytes and does not match the source (27,865 bytes; the source unchanged since 21:45:32). The next publish, 21:49, matches it byte for byte. The publish copied the old file.
- In the same thread, five more such pairs in 40 minutes. At 21:06:34 `publish_artifact` refused with "nothing to publish" (#24726): the file was not yet created by `write`, started 1 ms earlier (#24727). At 21:14:04, 21:33:43, 21:37:25, and 21:41:44 publishes and `write`/`edit` of the same target started within a millisecond.
- Reflection [[621f79f0]] is the same race: in thread 01a14ac9-fd71-7bf7-86d9-805862f6ffd9 the second publish (#105) started at 17:08:10.883, `write` (#106) at .882. Version `20261017T170810884Z` took the first contents.

## Cause in code

Turn order already exists, but only for writes to files declared as permission subjects.
- `executeTools` (`packages/agent/src/agent/turn/tools.ts:181-259`) launches all of the turn's calls with `Effect.all(…, { concurrency: 'unbounded' })`. A call awaits only earlier writers (`behind`, `:188-196`), and writers are calls whose preparation returned a file subject of kind `write` (`ToolExecution.rememberWrite`, `door/ToolExecution.ts:457-466`). A call without file subjects receives `behind` answering `[]` at once (`tools.ts:189-190`).
- `publish_artifact` (`apps/tagma/server/src/native-harness/skills/artifacts.ts:125-160`) declares neither `subjects` nor `prepare`, so it travels at once. That is the incident's cause.

The same mechanism lets other pairs through. Subjects are an approval fact, not a resource key: preparation counts them and writes them relative to the root for display and rules, and a tool with nothing to ask does not carry them.

## Hazard classes

| Pair in one turn | Today | Proof |
|---|---|---|
| `write`/`edit` P → `publish_artifact` P | race | confirmed by threads above |
| `write`/`edit` → `bash` reading the result (`cat`, tests, typecheck, git) | race | `bash` declares only `{ kind: 'execute' }` (`agent-tools/src/bash/tool.ts:177`) |
| `edit` → `submit_work`, `check_law` | race | `submit_work` declares only `taking:<thread>` (`landing/contract/wire/operations.ts:112-114`), `check_law` nothing |
| `write` X → `create_block`/`update_block`/`apply_batch` with `bodyFile` X | ordered only when the lines match | `write` writes the subject relative to the thread's cwd (`workspace/runtime.ts:113-116`), the operation relative to its place's root (`invocation/nativeDoor.ts:191-195`, `platform/contract/service/subjects.ts:14-17`). Conclusion: at a place with another root or without one (global) the lines diverge, and there is no order |
| `write` through a symlink → reading the same file under another spelling | race | write preparation takes the physical path, reading the lexical one (`runtime.ts:89-116`; the physical value pinned by `preparedSubjects.itest.ts:100-109`) |
| graph write → read or write of the same block | race | graph operations declare `noSubjects` (`graph/contract/wire/operations/reads.ts`, `writes.ts`) |
| read P → write P | unordered | a write awaits only earlier writers, never earlier readers (`tools.ts:188-196`) |
| `bash` ↔ `bash`; MCP- and plugin-tool calls (browser click → snapshot) | parallel | none declares file subjects |
| `spawn_agent` named X → `send_message` X | unordered | collaboration subjects are not files |
| `write` Y → `write` X `fromFile` Y | ordered, but false `file-changed` refusal | all calls prepare before any executes (`tools.ts:136-179`): Y's digest is taken before the first write (`write.ts:149-150`) and mismatches at execution (`write.ts:61-66`). Same on hosted: preparation precedes `writesBefore` (`thread/run/ThreadHosting.ts:495-498`) |
| `write` P awaiting approval → read P | same-batch refusal | correct, the rule stands |
| `edit` → `edit` of one file | ordered | works today |

The hosted road (Claude on `acp`) repeats the same rule over file subjects (`thread/run/hostedOrder.ts:60-61`), and the runner declares all Tagma tools to Claude Code `readOnlyHint: true` (`runner/claude-code/bridge.ts:23`), so there they also travel in parallel with the same holes.

Write order switches on only where the door holds an `AgentCalls` registry (`ToolExecution.ts:458`). Working threads pass it (`thread/agents/ThreadAgent.ts:504`), conformance doors do not.

## Decision

### Claims: what a call declares

A tool declares `claims(input, call)` → a list of `Claim { on, access: 'read' | 'write' }`. The declaration is written by the tool's owner beside its body. Claims count only from the input and the caller (cwd, place, addressee) and read no state another turn call changes. Path canonicalization reads only the namespace. When claims cannot be counted (a path outside the workspace, an empty path), the call refuses like a preparation refusal and holds nothing.

`on` has three kinds:
- `file` — a canonical absolute path. An existing prefix resolves to the real one (symlink, `..`); a nonexistent tail appends lexically. `@runlith/files` gives the canonical form ([[b77b7a93]]): a path's spelling and the OS dialect are its. Intersection is nesting: a directory claim covers its subtree.
- `key` — an owner's opaque line (`graph`, `artifact:<path>`, `agent:<address>`, `execution:<address>`, `call:<runId>/<toolCallId>`). Intersection is equality. The core does not enumerate keys: tool owners declare them.
- `all` — everything. Intersects any claim.

Conflict: call B after A depends on A when some claim of A intersects some claim of B and at least one of the two is `write`. That orders write→read, write→write, and read→write.

### Default for the undeclared

- A `Tool` without claims: `mutates: true` yields `write(all)` — a barrier: it awaits all earlier calls of the turn, and later ones await it. Otherwise `read(all)`: such a call awaits earlier writers and does not disturb other readers.
- A Tagma operation without claims: by the declaration's mandatory `effect`. `read` yields `read(all)`, `write` and `external` yield `write(all)`.
- MCP- and plugin-tools do not take part in ordering: they have no claims, the default does not apply to them, they await nothing and hold nobody — they execute as today. Tagma answers only for its own tools; another tool's call order is its author's concern.
- A tool answered by a reader (no `execute`, e.g. `ask_user`) does not execute in the turn and has no claims.

One default closes the incident: `publish_artifact` does not mutate, receives `read(all)`, and awaits the `write`. Exact claims are needed where the default takes parallelism away.

### Exact claims from owners

| Owner | Tools | Claims |
|---|---|---|
| `@runlith/agent-tools` ([[5565be05]]) | `read`, `ls`, `glob`, `grep` / `write`, `edit`, `rename`, `delete` | `file` of their paths (`read` / `write`) from the same resolution as path preparation; `write` with `fromFile` adds the source's `read` |
| same place | `bash` | Per `shellFacts` (`shellFacts.ts:473`) — the same analysis the change record judges commands by. Read-only means `read(all)`. Each named part with known paths means `read(all)` plus `write(file)` of those paths. Otherwise the `write(all)` default |
| same place | `webfetch`, `websearch` | empty set: they touch nothing local, await nothing, and hold nothing |
| native-harness, `artifacts` skill | `publish_artifact` | `read(file path)`, `write(key artifact:<canonical path>)` |
| graph | operations with `GRAPH_READ` / `GRAPH_ACT` | `GRAPH_ACT` — `write(key graph)` plus `read(all)`; `GRAPH_READ` — the `read(all)` default. Graph operations judge sources and read `bodyFile` and the `apply_batch` document from disk, so they await earlier writes; `read(all)` covers files from `files()`, no separate file claims needed |
| executions | `read_output`, `wait_command`, `wait_terminal`, `read_terminal` and writes into a live execution | `read`/`write` of `key execution:<address>`; `start_terminal` stays a barrier |
| calls | `wait_call`, `control_call` | `key call:<runId>/<toolCallId>` |
| collaboration | `spawn_agent`, `send_message`, `send_task`, `interrupt_agent` | `write(key agent:<address>)` per address; nameless `spawn_agent` — a key unique to the call |

Long awaits always declare a narrow key. With `read(all)` a record after `wait_command` in the same turn would have awaited the wait's end (read→write).

### One owner of turn order

`CallOrder` in `packages/agent/src/agent/door/` answers, for a turn's calls in model-answer order, their claims, and claims still held by past turns' calls, each call's blocking calls and the intersected resource. Native turn (`runStepTools`) and the hosted road (`ThreadHosting`) ask it. It replaces `behind`, `waitingWriteBefore`, and `callDependencyPath` from `turn/tools.ts`, `writes`/`rememberWrite`/`pendingWrites` from `ToolExecution`, and the `hostedOrder.writesBefore` road logic. It does not depend on the `AgentCalls` registry.

A turn:
1. All calls' claims count at once and in parallel.
2. Every call at once opens its own record in `AgentCalls`. A call with blockers stands `queued` with them.
3. A call whose blockers released the resources prepares (decode, `beforeTool` rules, `prepare`, verdict, confirmation). Then it either awaits a reader or enters the journal and executes. A dependent's preparation travels in its own turn because it reads the world: a `write` source's digest, checkout state at `bash`, the place and handover of operations. A call prepared before its predecessors would be judged against a state the model asked to change. Independent calls prepare at once and in parallel, as today.
4. Every call enters the journal (provision in turn intent) before its own effect starts. Calls prepared together commit as one record. Today one record covers a turn (`tools.ts:99-112`).
5. `read` and `all` claims release when the call answers, including with a background receipt. Terminal `write` claims hold until the call's work ends, in background too: today's rule for writes to files, now spread to following turns. A barrier gone to background holds no following turns. Order holds against the call's answer, not the process the call launched (`bash` with `waitMs: 0`, `start_terminal`, a child's work).
6. A call whose blocker refused before executing or was declined travels at once: no effect happened. A call whose blocker failed at execution also travels: every answer stays truthful and reaches the model in the same turn, as when executing one by one.

### Approval

When a blocking call awaits a reader's answer, the dependent refuses with the same same-batch refusal as file writes today, but with the resource and the blocker's address: "… must settle first: it waits for your answer. Call … in the next turn". Independent calls travel. Turn questions stand as today, after the remaining calls disperse. In review mode that means: a call after a mutating `bash` that asks receives a refusal, while a call after a `bash` parsed as reading does not.

### Hosted: Claude on `acp`

`ThreadHosting` asks the same `CallOrder`. Earlier calls of the sealed message count their claims from their input. Preparation for another (`hostedOrder.ts:66-99`) leaves. A call awaits every blocker until it releases the resources in the door or its record closes. An early call closed by the vendor without `started` holds nothing (today's `closing` observer). A hosted call prepares after awaiting.

`readOnlyHint: true` on all Tagma tools in the runner stays. Per [[00a81b23]] under the runner's options it changes only parallelism in Claude Code, while Tagma holds the order. The runner has no built-in Claude Code tools (`tools: []` or the vendor web, `runner/claude-code/lifecycle.ts:192`). Tagma does not order the vendor's `WebFetch` and `WebSearch`.

### Terminal CLIs

A batch of its own tools is ordered by the vendor (Claude Code by `isConcurrencySafe` splitting, Codex by the fair RwLock; see [[42061194]]). Tagma's lever is the operation annotations it serves over MCP: `readOnlyHint: true` exactly when the operation's claims hold no `write`. The annotation serves without input, so an operation declares claims as `{ reads?, writes? }` — targets by input, access static; `operationWrites` (`platform/contract/wire/operation.ts`) answers on it, and for the undeclared on `mutates`.

### What the feed shows

- Call record: an `execution` in `queued` state carries `after` — blocking calls (`toolCallId`, `toolName`) and a short resource mark: a path relative to workspace, a key, or "effects not declared". In `started` state `after` and `waitedMs` stay. The form's owner is `transcript/entries.ts`.
- Line (`chat-ui` `ActivityStep`): an awaiting call shows "queued · after write index.html", a started and finished one shows the "waited 69 ms after write" fact in its details. Today's cause "Waiting for an earlier write to <name>'s own paths to finish." (`ToolExecution.ts:100`) leaves.
- Activity `tool-call` receives a `tool-ordered` note with `after` and `waitedMs`. The order's price is measured on it.

### Price

- Claims: one canonicalization per path. Preparation paths already resolve that same path today, so file tools derive claims from that resolution, not a second one. `CallOrder` is O(n²) over the turn's calls (n is tens).
- Waiting appears only on conflict or on a barrier. Dearest are calls after a `bash` the analysis did not recognize: it is a barrier, and they await its answer, no longer than its `waitMs`. `waitMs: 0` releases at once. Claude Code and Codex do the same with their shells. One turn's graph records travel one after another, each one journal record.
- The performer measures on a working day's `tool-ordered` notes: the share of multi-call turns where someone awaited, and the awaited sum. This is one sample of the operator's machine, not a norm.

## Layers

- `packages/agent`: `agent/tool.ts` (`Tool.claims`, `Claim`); new `agent/door/CallOrder.ts`; `agent/turn/tools.ts`; `agent/door/ToolExecution.ts`, `AgentToolDoor.ts`, `ToolAdmission.ts` (preparation in turn); `thread/run/hostedOrder.ts`, `ThreadHosting.ts`; `transcript/entries.ts`; `collaboration/*Tools.ts`.
- `packages/agent-tools`: file-tool and `bash` claims; the `bash` description (`descriptions.ts`) says in one sentence what stands: one turn's calls touching one thing travel in call order, a command with unknown effects travels alone, `waitMs: 0` releases the turn at once.
- `packages/files`: the canonical path form for the key.
- `apps/tagma/server/src`: `platform/contract/wire/operation.ts` (`claims` of declarations and default by `effect`), `invocation/nativeDoor.ts` (passes claims into `Tool`), `cli/mcpTools.ts` (annotations from claims), `graph/contract/wire/operations/shared.ts`, `executions` operations and `native-harness/contract/wire/operations/calls.ts`, `native-harness/skills/artifacts.ts`.
- `packages/chat-ui`: `ActivityStep.svelte`.

[[8e0f35a1]] ("Order and awaits as native") is rewritten by the same change.

## Removed

- The `artifacts` skill line "in a later turn than the write, never beside it: the publish copies whatever the file holds when it runs" (`artifacts.ts:105-106`, commit 40512f6bcc at 21:49 UTC, three minutes after the incident). This is a prompt bypass, and after the change it would have described a restriction that no longer stands (prompts name only what exists). "Write the page to a file, then call `publish_artifact` with its path" remains.
- `pathOverlaps` exported from `turn/tools.ts`, `writes`/`rememberWrite`/`pendingWrites`, and advance preparation in `hostedOrder.ts`.

## Rejected

- **A prompt rule** ("Only batch tool calls that are independent", as Anthropic advises, or the skill line). The model still puts dependent calls in one turn: six such pairs in one thread in 40 minutes. A prompt is not a mechanism.
- **Sequential turn execution or `disable_parallel_tool_use`.** Correct, but loses reading parallelism — the most frequent batches. The provider flag additionally adds a model round-trip per call.
- **Only the binary flag** (safe/unsafe, as in Claude Code and Codex). Correct, but serializes independent writes: several edits of different files are a frequent turn. It stays the default for the undeclared.
- **Permission subjects as the order key** (today's rule, widened). Preparation counts subjects, after reading state. They spell relative to the root for display, and tools with nothing to ask lack them. The key is needed before preparation and must name the resource.
- **Locks in `execute`** (like `withFileWriteLock`). They give mutual exclusion, not order: a late call can take the lock first.
- **Refusing dependents of a failed call.** It would cascade-refuse readers arriving to look at the result. Every answer stays truthful and arrives in the same turn.
- **A barrier holding following turns until its background work ends.** Any background command would have stopped all further thread work.

## Out of scope

- MCP- and plugin-tools: Tagma declares no resources for them and orders neither their calls among themselves nor with its own.
- Standing work under [[d1caad35]] (`ready_work`): no task touches call order; everything stays as it stands.
- Launched readiness: `start_terminal` and its port's `webfetch`, `bash` with `waitMs: 0` and reading its output. Order holds against the call's answer; readiness is the model and `wait_*` tools' business.
- `tool_search` or `load_skill` and a just-opened tool in one turn: the model has not seen the scheme yet, the existing "reveal it first" refusal stays.
- Conflicts between threads in the shared checkout: the change journal owns them.
- Terminal CLIs' built-in tools and the vendor web on `acp`: the vendor orders them.
- Hard links — two names of one inode — yield two keys. The `@runlith/files` witness would have told them apart, but cost a stat per path and does not cover not-yet-created paths.

## Acceptance criteria

The performer proves:
1. Core — unit tests through `runStepTools` with fake tools on `Deferred`:
   - a `file` P writer and a later P reader: the reader starts only after the writer ends. Same for a non-mutating tool without claims;
   - `[read A, mutating without claims, read B]`: the barrier starts after read A's end, read B after the barrier's answer. Non-intersecting writes and reads start before any of them ends;
   - `[read P, write P]`: the write starts after the read ends;
   - a blocker awaits a reader: the dependent refuses with the blocker's address and the resource, the independent executes;
   - `prepare` of the dependent sees the state after the blocker's end (like `write` Y → `write` X `fromFile` Y without a `file-changed` refusal);
   - a writer gone to background holds its `file` claim in the next turn (today's `AgentStepWrites.test.ts` moves to the new owner); a barrier that answered with a background receipt releases.
2. `agent-tools` itest: `write` through a directory symlink and `read` on the real path yield intersecting claims. Relative and absolute spellings of one file and a path from another root yield one key.
3. Server itest with a scripted model and real tools:
   - one turn `[write fromFile → P, publish_artifact P]`: the published version's bytes equal the recorded ones;
   - `[edit A, bash "cat A"]`: the output carries the edit;
   - `[write X, create_block bodyFile X]` in a project with another root and in global: the block body equals the recorded one.
4. Hosted conformance: one sealed message's calls arrive in reverse order (reader first) — a reader executes only after the writer record closes; an early call closed by the vendor holds nothing.
5. Annotations of MCP-served operations derive from claims: verified in the existing served-catalog test.
6. `rg 'pendingWrites|rememberWrite|writesBefore|pathOverlaps' packages/agent` is empty, and the `artifacts` skill holds no "never beside it".
7. Price numbers (the "Price" section) recorded in the task.
8. No touched file crosses 650 lines without import ([[6b3210c7]]).

## What the operator verifies

This is not a task-closing condition.
- Native thread: ask to write a page and publish it in one turn. The link shows the new page, `publish_artifact` in the feed shows "queued · after write".
- Same on Claude via `acp`.
- Review mode: `write` and `publish_artifact` in one turn. `write` asks, the publish refuses with a clear cause and passes on the next turn.
