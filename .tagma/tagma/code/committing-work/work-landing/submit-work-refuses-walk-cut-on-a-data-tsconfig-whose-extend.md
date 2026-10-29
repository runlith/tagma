---
id: 01a18679-d5f7-7d63-a817-4658b089d651
title: submit_work refuses walk-cut on a data tsconfig whose extends names an uninstalled package, and whole does not bypass it
ord: 149
tags: ["reflection"]
fields:
  {
    "actual": "refused[walk-cut] on harness/samples/vite-plugin/e2e/preprocess-with-vite/src/index.ts: UnsupportedSource, its tsconfig.json extends `@tsconfig/svelte`, which resolves to no file the tree holds; the same refusal with and without `whole`.",
    "command": "submit_work paths [..., \"harness/samples/vite-plugin\", ...] whole [\"harness/samples/vite-plugin\", \"harness/manifest/vite-plugin\", \"targets/upstream/vite-plugin\"]",
    "expected": "Files carried whole land as they stand; a tsconfig in a copied sample tree needs no extends resolution to commit them."
  }
---
Filed from project `dromon`.

The file is upstream vite-plugin-svelte test data copied verbatim, and `@tsconfig/svelte` is installed only under the target package's node_modules. The unblock offers "ask again" (it is not a busy-server cut) or landing without the file, which would break the harness's copy check. The walk for a whole-carried path should not need the TypeScript project to resolve.