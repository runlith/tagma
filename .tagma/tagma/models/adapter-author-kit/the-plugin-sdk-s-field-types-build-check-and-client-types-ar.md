---
id: 01a1ae0e-74de-71b4-9c10-91ef09039173
title: The plugin SDK's field types, build check and client types are generated from the server owners' schemas into committed files
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/tagma/kit/generated.ts
  - kind: file
    ref: packages/tagma/src/plugin/points.generated.ts
  - kind: file
    ref: packages/tagma/src/plugin/schemas.generated.json
  - kind: file
    ref: packages/tagma/src/plugin/operations.generated.ts
  - kind: file
    ref: packages/tagma/src/plugin/check.ts
---
The SDK sits below the server: the server imports `@runlith/tagma`. Its field types and its build's check must still be the owners' point schemas, so the kit generates them instead of importing them. An import would close a module cycle, and it would pull the whole server into every typecheck of the package. `kit/generated.ts` reads the server sources as data and writes three committed files into `src/plugin/`:
- `points.generated.ts`, the encoded TS types of the envelope and of every point, plus their names;
- `schemas.generated.json`, their JSON Schemas;
- `operations.generated.ts`, the input and known answer arms of every `external: true` operation.

**Finding the parts.** A point is any `new ContributionPoint(id, { name, schema })` in the server, so the generator holds no list of points. The schema must be imported from its owner's `contract/wire`, or generation fails. Operations come from every `contract/wire/module.ts`. A new point or external operation therefore reaches the SDK the next time the files are regenerated.

**Running it.** Run `bun kit/generated.ts` after changing a point, the envelope or an external operation. `kit/generated.itest.ts` fails while any file is stale. It compares the TS by syntax tree and the JSON by value, because the commit's formatter rewrites both files.

**What the build checks.** The build checks a manifest by reviving these JSON Schemas with Effect and decoding with excess properties refused. Its messages are those of the server's own checks. JSON Schema carries no custom `makeFilter` check, such as a name listed twice, a reserved option key or unsorted sources. The build passes those, and the server refuses them at install. An owner who wants the build to catch a check writes it as a built-in check that JSON Schema carries.