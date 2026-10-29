---
id: 01a17bc0-f449-777e-b964-6047504fa5da
title: A computed import() closes its test's trace or the package declaration, and literal edges are not narrowed by the record
ord: 3
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a17ae4-e99c-7a84-8f27-dfb955b6930a
sources:
  - kind: file
    ref: scripts/change/graph.ts
  - kind: file
    ref: scripts/change/loads.ts
  - kind: file
    ref: scripts/change/testing/trace.ts
---
Tests run with `--no-isolate`: a module loaded or memoized by one file serves the same process's later files with no new load event. So a run's "what this file loaded" set is incomplete, and selecting on it would give a false green. Literal edges, including lazy `import()`, are taken from source and stay in the graph even if no test ever executes them. The record only extends the graph where the source doesn't name the target.

The record is bound to the importer, not the file: Bun calls `onResolve` on every `import()` execution, even when the module is already in the registry, so the place that fired during any traced file lands in the union of its importer's targets. For one test that union is only trustworthy if the test itself ran under trace with the importer's current contents: otherwise it could have loaded a target nobody recorded. Such a test is selected until traced, and only a passed file counts as traced; a failed one loses its old mark. An empty trace is also proof: if the importer didn't load in the test's process or its place didn't fire there, it loaded nothing in that process. Only specifiers missing from the importer's own literal imports are recorded: its static imports also pass through `onResolve`, but they are edges already. Every run writes its own delta, and deltas fold at read time, so two concurrent `check:change` runs don't lose each other's records. The record directory moves with the trace code.

If hundreds of tests reach one importer, tracing each doesn't converge: the first run doesn't fit the command's life, and no record appears. For such a place the package owner declares in `changeCheck.loads` what it can load from the checkout. The declaration is its contract, and every traced run checks it and fails the file if a load went outside the declaration. Targets outside the checkout are not recorded: that's no changed path.

The trace doesn't see loads in Workers, so an importer reached by a `new Worker(...)` edge closes only the declaration. It also doesn't see loads in child processes, or targets a test picks by data never seen in traced runs. Changing such a data file, unless it's a source, still selects its whole package.
