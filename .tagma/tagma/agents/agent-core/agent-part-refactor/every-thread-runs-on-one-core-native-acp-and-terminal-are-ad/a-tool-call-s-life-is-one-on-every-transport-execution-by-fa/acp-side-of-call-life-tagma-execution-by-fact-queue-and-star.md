---
id: 01a126a2-f80a-7baf-84ad-c1ffde05c11e
title: "ACP side of call life: Tagma execution by fact, queue and start from statuses, vendor results in history, truthful runner prompt, parallelism after P1"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a126a3-dbf3-774c-8c3a-c64308e483d1",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12685-91d6-74c9-bb18-016b7edf92bf
---
The ACP side in `apps/tagma/server/src/external-harnesses`: items 1, 2 (projection and terminal), 4 (projection side), 6, 12, and step 2 of item 13 with the P1 probe from the [[7edf92bf]] spec.

What to do:
- Runner Claude:
  - `tagma/executes` on call end only on entry into `Bridge.called`; the Tagma `tool_call` is `pending`;
  - a call without `claudecode/toolUseId` is rejected;
  - `WebFetch` goes `in_progress` on the `PreToolUse` hook;
  - repeat `call_hosted_tool` also on the `run-not-held` code (the core task returns it);
  - `servedPrompt` tells the truth about deferred tools.
- Projection:
  - `pending` → `execution: queued`, first `in_progress` → `started`;
  - the display of a Tagma call's initial record comes from `ThreadHosting.display`, computed before entry into `saved`;
  - in hosted mode the vendor's tool-result lands in `messages` after the assistant message holding the call.
- Terminal: `PreToolUse` opens the record as `started`.
- P1: probe `readOnlyHint: true` on a live `claude`, result as a #research block. Step 2 (annotation for every Tagma tool) switches on only after the core task commits `ready` into hosting, and only if P1 finds no other effect.
- Notes [[ae10d61d]], [[c5cc143d]], [[d0810682]] are rewritten by the same change.

Done when criteria 1, 3, 4, 12 of the spec are proven, typecheck and the protocol tests are green, review under the model rule passes.
