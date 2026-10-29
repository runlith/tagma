---
id: 01a16133-7dd9-72bd-a630-febd6cf82eed
title: "scip-typescript: one-shot index, shared AST cache, and misses on successful write"
ord: 4
tags: ["research"]
fields:
  {
    "source": {
      "name": "scip-typescript 0.5.1",
      "ref": "https://github.com/sourcegraph/scip-typescript/tree/b71b884270c25a6b1e148f078b54fa5920ca2990"
    }
  }
---
`sourcegraph/scip-typescript`, commit `b71b884270c25a6b1e148f078b54fa5920ca2990`, package version `0.5.1`, was read. [package.json](https://github.com/sourcegraph/scip-typescript/blob/b71b884270c25a6b1e148f078b54fa5920ca2990/package.json) uses `typescript ^6.0.3`, not the TS7 API. [ProjectIndexer.ts](https://github.com/sourcegraph/scip-typescript/blob/b71b884270c25a6b1e148f078b54fa5920ca2990/src/ProjectIndexer.ts#L70) creates separate `ts.Program` and TypeChecker instances per project via `ts.createProgram`, walks source files, and indexes the tsconfig input files. No oldProgram is passed here.

[main.ts](https://github.com/sourcegraph/scip-typescript/blob/b71b884270c25a6b1e148f078b54fa5920ca2990/src/main.ts#L29) opens the output file in `w` mode, writes metadata, and walks projects and project references in order. Documents serialize one by one, so the whole output index need not be held. `GlobalCache` lives for one run: shared SourceFile by absolute path and language version, parsed command lines, and a set of already-emitted files. That is reuse between overlapping projects of one run, not edit tracking and not a persistent cache; the command path read has no watch, content version, or invalidation on file change. The next command run recreates the cache and the output index.

Memory cost stays with Program/TypeChecker, AST, and symbol maps. The enabled global cache holds ASTs across projects, while `--global-caches` off removes that hold at the price of repeated work; the [README](https://github.com/sourcegraph/scip-typescript/blob/b71b884270c25a6b1e148f078b54fa5920ca2990/README.md#dealing-with-out-of-memory-issues-oom) directly describes this tradeoff. Streaming output does not solve compiler memory. The parsed path has no separate sharing mechanism for several processes, branches, or worktrees.

[FileIndexer.ts](https://github.com/sourcegraph/scip-typescript/blob/b71b884270c25a6b1e148f078b54fa5920ca2990/src/FileIndexer.ts#L44) skips files above a threshold, `1mb` by default from CommandLineOptions, reporting the reason to stdout. `ProjectIndexer.index` catches a visitor error, prints it, and may record the occurrences accumulated. `main` reports failure when no document was written; some documents present alone do not prove a complete run. `diagnosticsFor` produces a deprecation diagnostic, not a full compiler error set.

Definitions and references link through the TypeChecker. Implementation relationships follow ancestor/member declarations; contextual object properties have a special path. `visitSymbolOccurrence` sets an enclosing range for some global definitions but skips it for references and local symbols. There are no grounds to treat every reference as a call edge or these relationships as an exhaustive structural implementation search.

## Conclusion for Tagma

Per-file publishing and shared-AST reuse are useful, but running this CLI after every edit does not yield a live shared checkout engine. With a TS7 API first, reuse and invalidation of TS7 itself should be studied, rather than carrying over unsupported TS6 internals or treating GlobalCache as ready-made incrementality. Changing one file may require recomputing semantic dependencies, not just replacing its occurrences. Size skips, visitor errors, uncovered projects, and stale results belong in the navigation answer, not in the producer's logs.

## Not established

The code was read without installing dependencies or running indexing. RAM/latency, the benefit of disabling the cache on runlith, the TS7 effect, and completeness over the seven control symbols were not measured. No upper bound on edit fanout and no fitting memory budget for different-sized machines were established; the `1mb` number is an upstream default, not a Tagma recommendation.
