---
id: 01a1ae0e-74de-71b4-9c10-91ef09039173
title: The plugin SDK's field types, build check and client types are generated from the server owners' own code into committed files
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/tagma/kit/generated.ts
  - kind: file
    ref: packages/tagma/src/plugin/points.generated.ts
  - kind: file
    ref: packages/tagma/src/plugin/operations.generated.ts
  - kind: file
    ref: packages/tagma/src/plugin/checks.generated.js
---
The SDK sits below the server: the server imports `@runlith/tagma`. Its field types, the build step's verdict and its build's check must still be the owners' own, so the kit generates them instead of importing them. An import would close a module cycle and pull the whole server into every typecheck of the package. `kit/generated.ts` reads the server sources and writes these committed files into `src/plugin/`:
- `points.generated.ts`: the encoded TS types of the envelope, of every point and of checkout-builds' `StepVerdict` (as `BuildVerdict`), plus the point names;
- `checks.generated.js` with `checks.generated.d.ts`: a Bun bundle of the owners' code itself — the envelope, the plugin id label, every point's face with its schema and checks, and `contributionsRefusal` — answering `manifestRefusal` and `pluginIdRefusal`;
- `operations.generated.ts`: the input and known answer arms of every `external: true` operation.

**Finding the parts.** A point is any `new ContributionPoint(id, FACE)` in the server whose face is a binding imported from its owner's `contract/wire`, so the generator holds no list of points. Operations come from every `contract/wire/module.ts`. A new point, check or external operation reaches the SDK the next time the files are regenerated.

**Running it.** Run `bun kit/generated.ts` after changing a point, its checks, the envelope, the verdict or an external operation. `kit/generated.itest.ts` fails while any file is stale. It compares by syntax tree, so formatting and comments never make a file stale; the formatter skips the generated files.

**What the build checks.** The bundle carries the owners' filters (`makeFilter`) and cross-point checks as code. So the build's verdict is the server's: the same decode, the same checks, the same reasons. `effect` stays external, and the bundle runs on the SDK's own Effect, the server's version. Two things stay the server's alone: claims, which depend on the other installed plugins, and what a register checks at publication.
