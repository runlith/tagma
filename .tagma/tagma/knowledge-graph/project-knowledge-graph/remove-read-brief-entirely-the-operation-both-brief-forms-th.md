---
id: 01a15aff-1040-7594-a17f-e3b8e7da23d9
title: "Remove `read_brief` entirely: the operation, both brief forms, the assembly code, mentions in prompts, contracts, and the app"
ord: 228
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15aff-1172-7264-95ae-bd24ad2ffcdd",
    "status": "done"
  }
---
Operator decision: the brief adds nothing. The agent already has the prompt rules in the system prompt; code rules and code owners arrive when a file is read; the spec and the origin block are visible through the task's `read_block`. Meanwhile the brief spends tokens (repeating every rule), and the spec-writing brief imposes a template — the "MUST" order, "COVERAGE … a dimension left silent is a defect", the report format — against [[8dab19b6]]. The agent itself decides what to read.

Remove without remainder: the operation and its contract (`graph/contract/wire/operations/reads.ts`), the assembly (`graph/orientation/briefs.ts` and everything living only for it), `read_brief` in the `core/work` and `core/spec` behaviours (`graph/work/tasks/workBehaviours.ts`, `specBehaviour.ts`), the line "A brief is the reading a scope obliges…" in `graph/doctrine/graphReading.ts`, "read_brief — a task's first read" in `graph/orientation/sessionStart.ts`, all other mentions in prompts, tool descriptions, skills, catalogs, tags, and the app, the `brief` catalog profile (`catalogProfile.brief`) if only the brief needs it, the tests checking the brief. Descriptions of other operations that reference the brief must be rewritten to name only what exists. Graph blocks describing the brief: delete or fix.

The same operator decision removes `read_review_brief` with `tagma review` (`external-harnesses/cli/review.ts`) and its line in `graph/doctrine/review.ts`; the `tree-not-measured` refusal moves into proposal creation, if not there yet.
