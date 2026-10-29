---
id: 01a13f95-60fe-7047-a344-e33f81074aa9
title: Module check judges a tree whose tsconfig extends a generated file missing from the tree
ord: 42
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f95-99b8-7325-8d9a-d0a769566ef9",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a119ca-a4a8-739c-8fb6-1ccaf564b376
---
Module check judges a tree whose tsconfig extends a generated file missing from the tree.

set_module over the app catalog fails because its tsconfig's `extends` points at a file the build tool generates and which the judged HEAD tree lacks ([[f564b376|reflection]]).

The fix is shared by every tool and framework: the check core knows neither SvelteKit nor `.svelte-kit` nor other variants (rule 6f758080). The operator's requirements are architecture and 10/10 reliability:
- the same judged tree and declarations always yield the same verdict, whatever the working directory and machine state;
- a missing file never silently becomes a different result: either the file arrives by a declared road, or the judgement refuses with a type, naming the file and the declaration that fixes it;
- no new mechanism where an existing one (e.g. `built`) already answers the question.

Done when set_module and the commit judgement pass on a tree with such a tsconfig, contract tests prove it, and the reflection is closed by this task.
