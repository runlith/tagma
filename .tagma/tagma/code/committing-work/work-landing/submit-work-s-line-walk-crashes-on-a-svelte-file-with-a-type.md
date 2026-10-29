---
id: 01a18619-0f3e-74ff-b563-2b8c8e3aead2
title: submit_work's line walk crashes on a .svelte file with a TypeScript Debug Failure
ord: 148
tags: ["reflection"]
fields:
  {
    "actual": "refused walk-cut: \"Error: Debug Failure. Invalid cast. The supplied value [object Object] did not pass the test 'isArrayLiteralExpression'\"; landing needed whole for the two trees",
    "command": "submit_work paths=[\"harness/samples\",\"harness/manifest\"] taking=[\"convert\"] in dromon (1098 upstream Svelte runtime samples)",
    "expected": "The walk attributes the lines of harness/samples/svelte/runtime-runes/destructure-async-assignments/main.svelte and the commit lands"
  }
---
Filed from project `dromon`.

The file is upstream Svelte's sample `destructure-async-assignments/main.svelte` (svelte@5.57.3, tests/runtime-runes/samples), converted only by replacing `on:click` with `onclick`. The refusal names the cause as a crash, not a busy server: the TypeScript debug assertion comes from parsing the file's script, so asking again would fail the same way. The workaround was `whole` over the sample tree, which carries peer lines without attribution checks.