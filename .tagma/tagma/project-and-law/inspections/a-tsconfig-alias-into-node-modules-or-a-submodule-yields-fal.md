---
id: 01a17e9d-8307-7d99-9096-d85536d81783
title: A tsconfig alias into node_modules or a submodule yields false 'unresolved' in modules and platforms
ord: 41
tags: ["reflection"]
fields:
  {
    "actual": "15 'app-demo -> $lib/... unresolved' violations in apps/tagma/demo/app",
    "command": "bun src/cli/inspect.ts private-modules-map.json --repo ~/runlith/runlith (modules, runlith-private)",
    "expected": "`$lib/app/composition.js`, which TypeScript resolves to `node_modules/@tagma/app/src/lib/app/composition.ts`, is an installed-package import, not a violation"
  }
---
The TypeScript host in `configResolver` cannot see `node_modules`. An alias has no "outside" outcome, so any target in an installed place became `{unlisted}`, and the inspection reported a violation. A separate case: TypeScript maps a target in a member's `node_modules` via realpath to a member file in the tree, and Tagma still left it unresolved. Any project where `paths` point into an installed package is affected: SvelteKit wrappers, a demo building someone else's app, packages in a monorepo.
