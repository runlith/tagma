---
id: 01a120dc-d0fc-7570-a3f3-7062a6a73286
title: "The import check reads configs the framework generates outside git: a preparation step declared by the project"
ord: 9
tags: ["idea"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a119ca-a4a8-739c-8fb6-1ccaf564b376
sources:
  - kind: file
    ref: packages/code-facts/src/languages/js/config.ts
---
Question: give the import check reads of configs the framework generates outside git, so module cards can stand on SvelteKit, Nuxt and Astro apps.

What breaks now. Imports are judged over a tree assembled from the commit's git objects. `apps/tagma/app/tsconfig.json` extends `.svelte-kit/tsconfig.json`, which SvelteKit generates and which sits in `.gitignore`. Resolution in code-facts honestly refuses with `UnsupportedSource`, and `set_module` over any app directory gets `inspection-failed` ([[f564b376]]). That's why the thread-view card isn't recorded, and specs b7bb8a8f, 16997c14 and d68e71ff formally stay open. The code works, and commits aren't blocked. In [[0ce061a6]] the app is excluded from the module map for exactly this reason.

Why not guess aliases. `$lib` is only the default: a project adds its own aliases in `svelte.config.js`. `$app`, `$env` and Nuxt `#imports` are virtual modules with no files. Guessing is the same framework knowledge, only hidden, and a miss silently lets a forbidden import through. Skipping unresolvable imports switches the check off on the main internal `$lib/...` imports.

Proposed mechanism: a preparation step declared by the project.
- `tagma.jsonc` names a command that generates the missing entries, e.g. `svelte-kit sync` or `nuxi prepare`. Tagma knows no frameworks and runs the string, as it already runs commit steps.
- The command runs over the checked commit's tree, not the working directory; the same for HEAD, the base tree and the commit tree.
- The result caches by the step entries' hash, so a rerun is only needed when the framework config changes.
- The agent putting cards down writes the string, on the inspection's refusal, the way the `commit-steps` skill offers a formatter.
- Most projects need no step: for Next.js, Vite and plain TS projects `tsconfig.json` sits whole in git.

Unknown:
- where the step takes dependencies from, if the commit tree holds no `node_modules`;
- which entry set honestly hashes the cache key for each command;
- how fast such a step runs on large repositories.

Not urgent: decided to postpone until boundary-check work in the frontend.
