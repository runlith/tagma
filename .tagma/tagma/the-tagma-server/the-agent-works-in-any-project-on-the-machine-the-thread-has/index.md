---
id: 01a126b3-84d8-7b0e-a605-99311013e071
title: "The agent works in any project on the machine: the thread has one home, and each act is judged by and recorded at the place it is about"
ord: 113
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/operations/crossing.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/project.ts
---
## What the user gets

The user has several repositories on one machine: backend, frontend, libraries, personal projects. Each is registered in Tagma as a project with its own graph and its own rules. The agent of any of them, at the operator's request:

- reads and writes another project's graph;
- edits its files while receiving its law and notes, like its own agent;
- commits to its checkout, with that project's gates judging the commit;
- starts agents there and writes to them; a child in another project stays its child with the usual report and is visible in its Team.

The operator configures nothing: projects registered on the machine are already available. The `private` flag changes nothing here — it only keeps Tagma traces outside the git repository.

This also yields an experiment polygon: a synthetic product is just another project, the runlith orchestrator runs agents there, and the operator watches in the polygon's interface.

## Model: home and place

A thread has one **home** — the project where it was born. The home owns everything the thread itself is: the caller identity (`actor.projectId`), the feed and transcript, questions to the operator and approval grants, scratch, reports, the place in the thread list. The home does not change with where the thread works.

Each act is addressed to a **place** — a "project and its copy" pair (checkout or worktree with a graph copy). The place owns the act's subject and effect: the graph, the law (catalogs, tag declarations, project rules and the global rules applicable under its settings, notes), the policy (command rules, comment policy, checkout mode, commit steps), the checkout's line accounting, and the commit gates. The record of the act itself goes to the home's feed, with the place named.

The act's place derives from its subject, one rule per act kind:

| Act | Subject | Place |
| --- | --- | --- |
| file tool, `rename` | the changed path (`rename` — both) | the checkout containing the path |
| command | `workdir` | the checkout containing `workdir`; what the command writes to other checkouts is measured by their places |
| `submit_work` | explicit place or the single checkout where the session holds lines | one checkout: lines in two checkouts — even of one project — refuse, telling the caller to split the landing |
| graph act by block name | the block | the graph holding it (`crossing.ts`) |
| unnamed graph act (search, root creation, batch, overview) | explicit `project` | the project's main graph copy or the named worktree |
| threads: reading, birth | explicit `project` | the home of the read or born thread |

An input document (`bodyFile`, a batch file) is not a subject: it is read from the caller's scratch and selects no place. No indication means home. An explicit place contradicting the subject (a path or block in another project, a `parentId` from another graph) refuses `place-mismatch` with both named; neither is picked silently. A path outside all checkouts on the machine stays as today: the file is edited, with no lines and no law. Workspace (`CheckoutPaths`) provides checkout identity and coverage across all projects on the machine; `Projects` provides project identity.

**Project selector** — the name or id of a registered project; `global` is the permanent global project, `tagma` the sources project of the running server (via `Reflections.homeProject`, as today). A name clashing with an alias refuses `ambiguous-project`. The current `globalProjectTarget` (`global|tagma`) is replaced by this selector.

## Architecture

**One place semantics on all doors.** The place decodes in one place — admission in `invocation` — from one call field. Native tools, HTTP (`?project=`), socket, `tagma op --project`, the MCP catalog, and proxy `call_operation` serve it identically; operations declare whether they take an explicit place. Today this field lives differently everywhere: in query for CLI, in payload for graph and thread reads, absent from the MCP proxy (`cli/verbs/op.ts`, `cli/verbs/mcpServe.ts`, `cli/mcpTools.ts`).

**Invocation.** Admission separates the caller (thread, home) from the place. `signedCall` (`admission/project.ts`) no longer refuses `foreign-project` and no longer substitutes a foreign `cwd` with the home one: the named place becomes the call's place. Call services (`CurrentProject`, `GraphCall`, `CurrentGraph`, `ServedTree`, `ChangeScope`, `CallerWorkspace`) are built for the place and only in `invocation` (rule `4657a163`); `Caller.files`, authority, and `actor` stay thread-scoped. `CallerWorkspace` in a foreign place is the place's copy; today `actor.ts` yields `null` there and `submit_work` loses its workplace. The "thread and project" pair check when addressing an existing thread stays ([[30cfaf9e]]).

**Native door** (`invocation/nativeDoor.ts`). The catalog assembles on the home context, but the place resolves on every call: prepare, approval, execute, and settle run with the place's services. The place pins to the call key: settle and read-back after a restart look for proof of effect in the place's graph and journal (`graph/journal/callRange.ts` currently searches only the current graph, global, and the sources project). A changed path or project resolution after approval does not redirect the approved act.

**Graph.** The only foreign-graph mechanism is `OtherGraphs` and `atTarget` from `crossing.ts`; the project selector feeds it the place. `globalTarget` and the `input.project === 'global'` branches in operations are removed in favor of this mechanism. `titlesAcross` navigation (`graph/serving/routing.ts`) extends to registered projects, keeping the found copy's project and branch; an ambiguous short name refuses `ambiguous-name` instead of taking the first.

**Law of place** (`graph/orientation/`, `native-harness/turns/instructions.ts`, `native-harness/capabilities/touchRule.ts`). The thread's first act in a place — any, including a purely graph one — receives the place's full orientation before execution: its catalogs and tag declarations, all project rules, and applicable global rules under the place's settings (`Orientation.instructions`). The global project is not a law place: its rules already ride in each project's set under the home's settings. `file_reflection`, which itself routes an observation to the Tagma sources project, makes no place; the sources project becomes a place only by explicit address (`project: tagma`/name, a path, or a block in it). Paths then complement it with regional rules and place notes (`touches.ts`); today `placed` silently drops a path outside the home (`source-outside`), and the agent edits foreign code blind — the main defect this spec closes. Pre-execution delivery is part of prepare: today `touchRule` runs after the tool, and the first write without a read sees the law only after itself. The instructions snapshot is kept per place: set B does not invalidate set A (`Instructions.ts` currently holds one last set), updates and withdrawals reach each place separately, compaction preserves the law of every place where the thread works.

**Place policy.** Consumers that currently take the home get the place: operation checks before and after (`enforcement/operationChecks.ts` skips a file outside `workingRoot` and takes head by `actor.projectId`), after-edit, command rules and command timing (`executions/commands/times.ts`), checkout mode and comment policy (`native-harness/capabilities/worldTools.ts`), git admission.

**Line accounting** (`change-record/`). A line carries the place's (checkout's) project and, separately, the holder's home. Everything reporting holder state checks the "thread and its home" pair ([[30cfaf9e]]), not the "thread and the place's project" pair: cleanup of deleted threads (`retire/store.ts` `orphaned` would currently revoke thread A's lines in checkout B at startup), holder reads and `read_changes {agent}`, `taking`, the turn, end, and commit history (`record/sessions.ts`, `operations/changes.ts`, `changes/stream.ts` are project-scoped today). `Intake` places the line in the checkout containing the file, among all projects' checkouts on the machine; today an outside-home write passes with `kept: false`. A command with `workdir` in a foreign checkout is measured as in one's own. "No run ends holding lines" extends to every checkout where the session holds lines.

**Landing** (`landing/`). `submit_work` commits to the place's checkout; the place's enforced rules judge, commit steps come from the place's `tagma.config.ts`, thread tasks are the session's tasks from the place's graph. `paths` stays a relative filter inside the chosen checkout.

**Birth** (`threads/`, `packages/agent/src/collaboration`). `spawn_agent project` carries the place through `BirthRequest`/`BirthInput` to both facet writers (`threads/harness/births.ts` and `native-harness/rows/native.ts`; the external child — `threads/birth/externalRows.ts`) and enters the birth digest (`collaboration/births.ts`). The child's home is the place's project; placement (`threads/harness/engine.ts`, `threads/birth/placement.ts`) resolves in it: the place's main checkout by default, `worktree: new` cut from the place's chosen checkout; the parent's assignment, scope, and resources do not carry over. The child's type and profile resolve in the place's catalog (`ThreadTypes.resolve` currently resolves under the parent). Depth, team budget, and delegation are lineage properties: their ceiling is taken at the team's root, like the current depth. History carried by a fork does not make A's instructions effective in B. `gateProject` in `birth/acts.ts` stops requiring parent and child homes to match.

**Team across projects.** Lineage, reports, team names, and `reach` already follow the thread line. Their server consumers become cross-project: `list_agents` and Team (`threads/store/directory.ts` currently filters by the caller's home; the `ThreadDirectoryRow` row gains the project), family traversal (`threads/list/select.ts`), notifying the parent of the operator's words to a child (`threads/turns/reader.ts` currently passes `gateProject`), the route of grant questions to the parent and of reports. Project B's list and A's Team are two projections of one lineage.

**External harnesses.** Terminal-CLI hooks (`external-harnesses/hooks/door.ts`) call `touch_path` and `record_write` with each path's place, not `CurrentProject` (`change-record/operations/record.ts`); terminal guidance and ACP tools get the place's law via the same per-place snapshot. Their `record_write` stays a post-write message, weaker than typed intake — the guarantee boundary is the same as in the operation's contract today.

**Approval.** The act's place does not change approval: an act in another project on the machine is judged by the thread's mode just like at home — reading never asks, writing asks where it would ask at home. A registered project on one's own machine is not a risk boundary: the agent, the operator, and their power are the same, and a place mistake is caught by `place-mismatch`.

**App** (`apps/tagma/app`). The child lives in its home's thread list and stands in the parent's Team marked with its project; its feed opens with the row's project (`ThreadPort.ts`), not the parent's. A `[[name]]` reference to another project's block opens in that project.

**Prompts.** The Tagma agent definition ("You work ONE project") and tool descriptions promising "a thread's calls act in its own project" are rewritten for the "home and place" model by the same change.

## Rationale

- The place derives from the act's subject: law, accounting, and gates already belong to the project and checkout; all that is missing is to stop substituting the home for the place.
- The home does not move: the feed, questions, and list stay where the operator started the thread, or the thread would "drive away" out of sight on every foreign act.
- No second foreign-graph mechanism is introduced: `crossing.ts` already walks foreign graphs by block name; the `global|tagma` branch is a special case of the same.
- Rejected: a mediator plugin (walks around the boundary instead of removing it); a "permit other projects" setting (on their own machine the operator already holds full power, rule `0f144655`).

## Stages

1. **The agent works in a foreign project itself**: place on all doors, admission, graph, law and policy of place, line accounting and landing, call recovery, prompts.
2. **Agents in a foreign project**: birth in place, team across projects, questions and notifications across homes, external harnesses.
3. **App**: a child marked with its project in Team, navigation across projects by reference.

## How to verify

The performer proves it with contract integration tests on two projects A and B, where B has its own rule, command rule, and a worktree with a differing graph. State and the typed outcome are checked, not prompt text.

- Thread A creates a block in B by `project` and edits a B block by name: the blocks land in graph B; an act with `project: B` on an A block refuses `place-mismatch`.
- The first act in B, purely graph, executes after the thread has received orientation B; after a law change in B and after compaction, the thread's B set is current and set A is not removed.
- Editing a B file yields B's regional rule and a session line in checkout B; after a server restart the line is in place.
- `submit_work` in B violating B's gate refuses `rule-violated` of that rule; after the fix the commit lands in B, A untouched; the operator's and another session's lines in B stay theirs; lines in two B checkouts refuse to split the landing; B's worktree is judged by its own graph.
- A response to an act in B, lost after the write, answers with the effected outcome when the same key is retried.
- A command with `workdir` in B runs under B's command rule.
- `spawn_agent project: B` births a child with home B, B's main checkout, and a type from B's catalog; after a restart it is visible in the parent's `list_agents` with project B, its report and grant question reach the parent, the notice of the operator's words to the child arrives.
- Narrow `tagma op --project` and MCP proxy scenarios yield the same place as the native tool; a terminal hook places the line in checkout B.
- A path outside all projects is edited with no line and no brief, as today.

The operator verifies on a synthetic project: the runlith orchestrator runs an agent there, the agent violates the polygon's rule, and the refusal is visible in the polygon's interface; the polygon's child is visible in the orchestrator's Team.
