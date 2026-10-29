---
id: 01a13fce-1448-71e1-a8a2-453d8f9cb294
title: A tsconfig alias lands as TypeScript does, and a file TypeScript doesn't know lands on the tree-held first alias target
ord: 10
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a13f95-60fe-7047-a344-e33f81074aa9
sources:
  - kind: file
    ref: packages/code-facts/src/languages/js/config.ts
---
TypeScript (`resolveModuleName`, Node10) tries only its own extensions and never lands `$lib/View.svelte`: a Svelte component through an alias became a false unresolved. So after TypeScript fails, code-facts itself counts the alias targets by TypeScript rules — the exact `paths` key, otherwise a template with one `*` and the longest prefix, the first `*` replaced; the base is `baseUrl`, otherwise the directory of the config that declared `paths` — and lands on the first target the tree holds as written. Everything TypeScript lands itself (`.d.ts`, `index.tsx`, `.mjs` → `.mts`) stays its own.

- `unlisted` of an unresolvable alias is its first target, like a relative specifier. Exception: a target in an installed place — in `node_modules`, in a submodule from `.gitmodules`, or outside the checkout. Then `unlisted` is that target, and `modules` with `platforms` count the import as an installed-package load, outside and not judged, like a third-party package import by name. Otherwise an alias into an installed package's sources (`$lib/*` → `./node_modules/@scope/app/src/lib/*`) would be a false unresolved.
- A target in the `node_modules` of a package that is itself a workspace member is first retargeted to its directory in the tree, as TypeScript retargets it through realpath. Without that, such an alias would go outside, and a member import would silently drop out of judgment.
- The directory of the config that declared `paths` is TypeScript's internal `pathsBasePath` field, not a public API: a TypeScript update rechecks it with the alias tests in `tree.test.ts` and `modules`.
- A `paths` value that isn't a string list refuses with the key named: TypeScript config parsing doesn't check it.
