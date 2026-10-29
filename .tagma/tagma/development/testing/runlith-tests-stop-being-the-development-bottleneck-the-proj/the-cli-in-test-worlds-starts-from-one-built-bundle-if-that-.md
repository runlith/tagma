---
id: 01a16e4e-92d1-7320-a303-9879782fe281
title: The CLI in test worlds starts from one built bundle, if that is markedly cheaper than starting from source
ord: 33
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-dc3b-7bb7-abeb-578f9f565e34",
    "status": "closed"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
---
Every CLI and hook start in tests loads ~452 modules from source, ~0.4 s CPU ([[c4fdb83b]]); `enforcement/commitGate.itest.ts` does about 40. Measure whether starting from one bundle (`Bun.build`, disk cache keyed by input hash — the same `cachedArtifact` mechanism as the host bundle, `packages/execution-host` `buildArtifact.ts`, [[3634462d]]) cuts the start cost severalfold. If yes — test-world CLI runs from the bundle, one test keeps starting from source; if no — refusal with the number.

**Measurement 2026-10-24, Apple M2 Max under other agents' load, user+sys `time -p`, 3–5 starts per variant** (`Bun.build` from `composition/entries/cli.ts`, `target: bun`, `bun` conditions):
- `check --gate`, server unreachable: from source 0.41–0.46 s; split bundle (1589 chunks) 0.21–0.33 s, split and minified 0.24–0.27 s; single file 0.84–1.02 s, single file minified 0.71–0.90 s (without splitting, the whole code of lazy verbs loads and parses).
- `op read_checkout`: from source 0.66–1.06 s; split minified bundle 0.64–0.65 s, first cold start 1.70 s.
- Bare `bun -e '0'` — 0.07 s; the rest is effect and contract execution, which the bundle does not remove.
- Bundle build — 2.7–3.8 s per change of the CLI inputs.

**Decision: not done.** The best variant cuts a `check` start ~1.7×, an `op` start 1.0–1.5× at wide spread, which on `commitGate.itest.ts` (~40 starts) is worth about 5–7 s CPU, while the build eats 3.8 s on every change of the CLI sources. That is no manifold cheapening worth a second way to start the CLI in tests.
