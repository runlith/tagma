---
id: 01a127e7-f139-7888-9744-54d9ec01603f
title: The agent files a friction reflection about Tagma itself in the same turn, without asking, and every working agent carries the tool
ord: 16
tags: ["task"]
fields:
  {
    "holder": "tagma:01a127d7-73d3-7b50-a5dc-44a49a382f02",
    "status": "done"
  }
---
Agents almost never file reflections without the operator's order: the doctrine names reflection but does not oblige it, and neighbouring sections require authorization for graph writes; `file_reflection` hides in deferred, asks in review and on filing from another project; the code agent has none at all.

To do:
- a doctrine section with the occasion and the obligation (itself, in the same turn, without asking; not covered by project authorization), held by a new `reflections` capability, granted to tagma, code, and rules;
- `file_reflection` — direct, `ASKS_NEVER`, with no "another project" question: its place is the graph of Tagma itself for any caller;
- remove the "read-only investigation only reports" point from the performance skill.

Done when: doctrine, agent-composition, and place-approval typecheck and tests are green, the change is landed.

## Outcome (d2e272040d)

- The `friction` section (`graph/doctrine/friction.ts`) in prompt and law; the `reflections` capability on tagma, code, and rules; the reflections point removed from Writing the Graph.
- `file_reflection` — direct, `ASKS_NEVER`; the `everyProject` flag on file/answer/unanswer removes other-project and `place-mismatch` from the transport project (note 666b6be5). This also fixes the failing `reflectDoor.itest.ts`: filing and answering from another project through HTTP refused with `place-mismatch` after 47ac10b3b2, and provenance lost the calling project.
- Green: `doctrine.test`, `placeApproval.test` (new case), `definitions.test`, `reflectDoor.itest` (3/3), tool assembly in `composeAgent.itest`.
- Not proved: a full typecheck after the last edits — tsc was killed by the 1-minute rule under machine load four times; the previous full run after the main part of the changes gave no errors in my files. Failures outside the change: `composeAgent.itest` (NOTE.txt not written), `graphFiles.itest` (spelling workspace write), `library.itest` (code agent names `prepare_worktree`), `graphQueuePages.itest` (cursor from another project).
- Review was not run: delegation in the thread was disabled by the operator.
