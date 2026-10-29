---
id: 01a16e1c-325d-7a9b-8e01-ab79dba33173
title: "In-process adapter decision: needed and built; the SQLite path never cost 70%, only children and about 10% of a file's JS"
ord: 5
edges:
  - kind: discovered-from
    to: 01a16e04-e4a2-7707-aae0-722c1e1fdc28
sources:
  - kind: file
    ref: packages/sqlite-process/src/inline.ts
  - kind: file
    ref: packages/sqlite-process/src/testing/pool.ts
---
**Decision.** A process adapter is needed and built (0e6826c8c1, b244bc371a): `ProcessPool` receives connection hosting from whoever builds it. The product (`composition/server.ts`) passes `childHosting`, test worlds pass `inlineHosting` through `heldPool`/`sharedPool`. Nothing changed above the channel: `Connections`, `Readers`, handover, retire, writer stall, checkpoint, and child accounting run shared code. What works differently in process and which tests therefore stay on child is recorded in [[a6950a0e]]. One channel conformance suite (`packages/sqlite-process/src/hosting.itest.ts`) runs on both hostings.

**Why, with the figure.** Measurements 2026-10-24, Apple M2 Max, load average 20–24 from other agents, `--parallel=1`. Each measurement one sample, so this is a pointer, not a norm.
- `http/collaborationDoor.itest.ts`, 4 tests: 33.9 s file CPU on processes, of it 15 SQLite children — 5.2 s. In process — 20.4 s, 0 children; one test in that run hung on a test race that the x-http fix removed.
- `graph/farEdges.itest.ts`: 12.7 s + 1.1 s SQLite children on processes vs 13.8 s in process — no gain inside noise: the file holds git (about 180 starts).
- The earlier "71.5% CPU on the SQLite path" figure was mostly an attribution error. 59.2% of that profile's samples are Effect fibers continued synchronously inside `connection.ts receive` — product code on the IPC-handler stack. The client's own cost is 5.7% (`measured`: fingerprint SQL) and about 4% (`send`, serialization). So process hosting removes SQLite children (474 of the baseline's 5220 s [[3c13cbc1]], about 9%) and about 10% of a SQLite-heavy file's own JS, not 70%.

**What else the producer removed (for the product too).**
- The SQL fingerprint in `measured` computes once per query text (f65cad66a3).
- The `bun:sqlite` statement cache defaults to 20 texts per connection, while the door world runs 400–500 different ones. Statements recompiled, `prepare` took 4.5% of samples. The host sets `Database.MAX_QUERY_CACHE_SIZE` 512 (b244bc371a); in the next profile `prepare` is 1.4%.

**The danger from this spec confirmed.** Synchronous lock waiting under `busy_timeout` in one process hung a spike at 60 s. In process `busy_timeout` is 0, and BUSY retries on a timer to the same deadline.

**What remains.**
- About 140 store opens in tests run without a pool and spawn children by default (`new ProcessPool()` in `platform/store/open.ts`). The default moves to composition with task [[3201be28]]; until then tests pass `sharedPool`.
- A quiet graph-part and door-file measurement before and after — in the 17:30Z measurement, when all agents stop.
