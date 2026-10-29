---
id: 01a16e97-4ed1-7bf2-9e96-15bb8065b63a
title: "Workflow: bring to done, rewrite, or rethink — the first run stalled, the idea is untested"
ord: 19
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9292bfecd8d9
  - kind: relates
    to: 01a16e94-25d4-71b5-b4de-77ee40c6c78e
sources:
  - kind: dir
    ref: apps/tagma/server/src/native-harness/workflows
  - kind: dir
    ref: packages/agent/src/workflow
---
**Question.** Workflow ([[bfecd8d9]]) — a JSON description of an agent team the server itself leads: steps, parallel batches, transitions, report gathering. Until the 2026-10-24 probe it had not run in work for two months; that probe stalled on the second step ([[40c6c78e]]). Report-delivery and status-keeping errors are fixed in the [[d70b4350|runtime fix]], but an isolated check does not establish whether a static scenario is useful in work. What to do with it: bring the current engine to done, rewrite it, or rethink the idea itself.

**What the first run showed** (a `council-probe` on two Muse Spark agents and a chair):
- Participant reports arrive in the run thread as ordinary messages and open its turn. The thread itself answers as an agent on the default model, and starting the next step refuses `run-conflict`.
- A fallen run stands `running` forever: `drive` catches the cause and only writes it to the server log, `read_faults` does not see it.
- In `council-probe` the chair received only the question and was told to find the reports itself. There is no automatic handoff without binding, but the current `input` can take `reports` from the `answers` step directly via `from: step`; no transformation is needed for that. `standing-proposals` is a separate transformation of graph findings for `review`.
- A step's model is set only through the agent type. A participant inherits the full Tagma agent: a start prompt of about 135 thousand characters each.
- The supplied `.tagma/workflows/review.json` is dead.

**What a static workflow gives over an agent coordinator:**
- order and completeness held by code, not prompt: the next step only after all reports;
- launch with no leading model — from schedule, webhook, plugin, or CLI;
- the same process by name.

**Against:**
- Dynamic work, where the leading agent cuts the task itself and changes the plan mid-course, is not replaced by a static scenario.
- Repeatability mostly comes from a skill.
- At Claude Code, dynamic workflows are an orchestration script the model writes itself for the task, not a file a person wrote in advance.

**What will decide the choice:**
- whether event-driven automations with no leading agent are needed;
- whether a repeatable process with a rigid order is needed, e.g. a model council or review;
- whether the same comes from a trigger that wakes an ordinary agent with a skill.

The choice between the three roads — finish the engine, rewrite it, or replace it with triggers to an agent — is not made.
