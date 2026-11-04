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

**Birth.** One reader per question, born like a workflow member (`ThreadWorkflowMembers.startMember`): the spawn tree with `reportDelivery: 'collect'` and a `bornOf` naming the call, under the caller's thread, under the same delegation and offered-type law as any child. Model: the definition's; else the caller provider's `lightTextModel`; else the caller's model.

**Wait.** The call waits on each reader's fact — its answer, its forced partial answer, or the diagnosis a failed run reports — through the same collection workflow steps use. It has no deadline of its own: the readers' budgets bound them, and a wait ends on a fact, never on a clock. Stopping the caller's run stops its readers.

**`answer`.** The reader's final answer: `text`, `evidence` (a path with lines, or a block name, each), `complete`, and `missing` when incomplete. It closes the reader's report obligation as `send_message` with `final` does, and the collected report carries these fields.

**Result.** One entry per question, in question order: `answered`, `partial` or `failed`, the text, evidence, what is missing, and the reader's thread id — rendered compact for the caller's context.

**Visibility.** Readers are recorded threads, not team members: they stay out of the thread list, the team tree, its counters and `list_agents`. The call's card in the caller's feed shows each question with its state and answer and opens its reader's thread. Readers are archived when the call returns.

**Caller guidance.** The tool description says when to ask — facts about how a part is arranged, where something lives, what owns it, what a contract says, independent questions batched in one call — and when not: design, judgement, changes. It tells the caller to verify only what its decision rests on. The Collaboration voice, which tells an agent to do the work itself and start a child only for a named gain, names `ask` as the way for such lookups, so the two never contradict. No text names a model.

**Reach.** The native tool, and the operation of the same name for foreign-CLI threads through Tagma MCP, run by the same collaboration core plane.

**Acceptance.**
- Through the native tool with a scripted model: three questions give one result with three entries in question order; the caller's run receives no report turn; the readers are absent from the thread list and archived after the call.
- One reader's provider failure gives that entry `failed` with its diagnosis while the others answer.
- Stopping the caller's run leaves no reader running.
- The operation through Tagma MCP from a foreign-CLI caller returns the same shape.
- The feed card lists each question's state and answer and opens its reader's thread.
