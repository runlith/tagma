---
id: 01a0cb47-64ed-76b0-8d6a-1f28da80d060
title: "stopAllBackground names a caller no panel has: dead act from the removed ProcessPanel"
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0ef66-2a57-7743-a071-ea8d175e31bd",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/terminals/CommandActivity.svelte.ts
---
`stopAllBackground` (`CommandActivity.svelte.ts:566-569`) is unreachable: the identifier occurs once in the whole repository — only its definition. Its naming comment is gone, but the defect stands: no drawer header or panel calls it. Its only caller ever was the deleted panel's Background header (`ProcessPanel.svelte:172`), removed by `159b06f7ba` ("unify thread activity into one compact sidebar panel"). That removal left `showFinished` (`CommandActivity.svelte.ts:439`) as a `$state` that can never be false — but its behaviour is deliberate (the finished lines are always in view), so only the state is debris.

Either give the drawer's Background header the act or remove it — leaving an act that names a caller nobody wrote is the defect. Done when nothing names a caller that does not exist and the panel state has no dead field.