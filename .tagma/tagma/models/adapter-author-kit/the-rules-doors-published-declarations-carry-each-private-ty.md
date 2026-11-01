---
id: 01a19553-ff24-7289-93ea-9c42ade3bab6
title: The rules doors' published declarations carry each private type expanded where it stands, and a reference the kit cannot expand fails the build
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/tagma/kit/declarations.ts
---
The `/rules` doors import types from private packages (`@tagma/inspection`), which the published package does not ship. Before emitting declarations, the kit replaces each such reference with the type it denotes: `typeof X`, `X[...]` or a bare `X`, read from the private module's runtime export (a schema printed in its encoded form, or a literal array printed as a union). It does this wherever the reference stands: a whole alias, a field inside an object type, or a type parameter's constraint or default. Only a reference to the imported binding expands. A declaration or property that bears the same name keeps it, and so does a type or value parameter that shadows the import within its scope; substituting the import's type there would publish a different contract without error. A reference of any other shape, such as a private generic, throws at emission, because declarations naming a missing package would leave authors' `tagma.config.ts` untyped. The same expansion runs as a Bun macro in the server's signature table (`enforcement/rules/signatures.ts`) and so at every release build; `kit/declarations.itest.ts` runs it over the real doors so that a door change it cannot expand fails at its own tests rather than at a build.