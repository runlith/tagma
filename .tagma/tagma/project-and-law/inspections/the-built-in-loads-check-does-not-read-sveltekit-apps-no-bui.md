---
id: 01a14fe1-68a6-75bb-b5ad-79da69b181b9
title: "The built-in loads check does not read SvelteKit apps: no built parameter for the generated tsconfig"
ord: 45
tags: ["reflection"]
fields:
  {
    "actual": "loads by its description fails wholesale on a config whose extends chain reaches a file missing from the tree, and has no built parameter; apps/tagma/app (and apps/tagma/site) cannot be measured with this check",
    "command": "read_inspections (project runlith) — picking the built-in check for the rule \"apps/tagma/app features do not load $app/navigation and $app/state\"",
    "expected": "loads accepts a generated-tsconfig declaration (`built`, like modules and platforms) and can measure the loads of a SvelteKit app whose tsconfig extends ./.svelte-kit/tsconfig.json"
  }
---
Filed from project `runlith`.

Limitation `loads`: "a config whose `extends` chain reaches a file the tree lacks fails the inspection naming it". `modules` and `platforms` have `built` for the same case (rule 083d37f1 already carries `{output: apps/tagma/app/.svelte-kit/tsconfig.json, source: apps/tagma/app/kit.tsconfig.json}`), `loads` has no `built` parameter. `apps/tagma/app/tsconfig.json` extends `./.svelte-kit/tsconfig.json`, which git ignores. The conclusion comes from the check description, with no run: the rule was not switched on (audit dbf104d3, spec b96e483e, the "Rules with a check" item).
