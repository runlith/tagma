---
id: 01a15baa-ccc3-7926-9908-cbd9e645796e
title: "\"The server and CLI executable JS are size-bounded files: the JSC sampler hashes the whole file for every newly sampled class with fields\""
ord: 9
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a15b5f-d36f-79b5-b2ae-826a26950d67
sources:
  - kind: file
    ref: apps/tagma/server/src/cut/release.ts
  - kind: file
    ref: packages/bundle/src/bundle.ts
---
The loop pause at server startup and on first use of features grows with the bundle file size. The JSC sampler (`CpuProfiler`, always running) computes `CodeBlock::hash()` for every newly sampled CodeBlock — SHA1 over the UTF-8 of its whole source — within the GC marking limit while the world is stopped, or in `Profiler.stop` on the loop itself. For the file program and for every class's synthetic field initializer the source is the whole file, so every class with fields, first caught in a sample, costs SHA1 of the whole bundle. The developer cut already lays the map next to the bundle, not inside ([[26950d67]]), but the code itself remains: ~20 MB of server and ~17 MB of CLI in the developer cut, ~11.6 MB of minified server in the release.

**Measured** (one machine, Apple Silicon, Bun 1.4.3, one sample per point):
- a `// @bun` file of 60 MB with a class with fields under a 1 ms sampler — a 337–346 ms GC pause; the same class without field syntax — 1 ms; a 1 MB file — 7 ms; indentation before or after the class — the same;
- a symbolized `sample` of its instance: the GC helper thread with 372–388 samples in `SHA1::processBlock < CodeBlock::hash < SamplingProfiler::processUnverifiedStackTraces < Heap::addCoreConstraints`, the main thread waiting meanwhile;
- the server on the developer cut: with an inline map (a 77 MB file) — 3–4 GC pauses of 420–600 ms per start; with the map alongside (20 MB) — 2–3 pauses of 53–346 ms;
- `Bun.build` with `splitting: true` on `composition/server.ts` yields 1368 files, the largest 1.56 MB unminified and 1.23 MB in the release.

**Do.** Bound the CLI and server executable file size: code splitting in `@runlith/bundle` (right now it refuses when the entry yields more than one file) and writing chunks, their maps and closure parts in the cut — with the release proof, `tagma:stack`, closure check and startup time verified. The other road is a fix in Bun/WebKit so the sampler never hashes the file's whole source. Splitting bundles into chunks was landed and rolled back (d2d3894afb, fdf693e284); right now bundles are one file each. Done when no startup pause grows with bundle size.
