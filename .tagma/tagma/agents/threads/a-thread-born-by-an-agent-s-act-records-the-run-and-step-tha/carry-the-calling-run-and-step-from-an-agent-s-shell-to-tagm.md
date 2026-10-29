---
id: 01a0d149-a07f-7b9c-acbb-8efb1463d04c
title: Carry the calling run and step from an agent's shell to Tagma's thread-create and workflow-run doors, so roots it launches record bornOf
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d138-dbb9-74e0-9449-ec3fdd5247d3",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0d136-c5cd-7ddb-b0e2-375737a0a3ab
  - kind: implements
    to: 01a0d136-c362-7db2-9eaa-907eddba1d6c
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/http/caller.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/credentials.ts
---
A root an agent launches from its shell (`tagma thread create`, `tagma workflow run`) reads `bornOf` null today, because the call carries no run and no step: the shell's HTTP call is identified by the `x-tagma-grant` header alone, and a grant names only a thread (`apps/tagma/server/src/protocol/grant.ts#grantFor`, read in `apps/tagma/server/src/http/caller.ts`). `ThreadActs.create` and `Workflows.start` already take a `bornOf` and write it on the root they open (37a0a3ab); nothing hands them one. Until this lands, the launch groups of [[a4acd1ed]] (the "Research ×30" row) group nothing an agent launched from its shell.

**Shape found while building 37a0a3ab** — a proposal, not a decided contract:
- the bash tool puts the calling run and step into the command's environment per call, for example `TAGMA_SESSION_ACT=<runId>:<step>` (packages/tools; the step is on the call identity since 37a0a3ab, `ToolCallIdentity.step`);
- the CLI door (`apps/tagma/server/src/cli/door.ts`) forwards it as a header beside the grant;
- `http/caller.ts` accepts it only where the run belongs to the grant's thread, and puts it on the thread actor;
- the thread-create and workflow-run handlers pass it to `create` / `start` as `bornOf`.

**Needs its own answers before building** (spec list 12 and 16): who may name which run, where that is checked, what happens when the check is wrong or the run has ended, and what a backgrounded command that outlives its step names.
