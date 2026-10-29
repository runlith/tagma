---
id: 01a0c83d-beef-7aa5-aef9-0251cec8a0bd
title: Build the zone for the performance vocabulary
ord: 87
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83d-be5e-7beb-99fc-b3492a74de70
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/performance/src/PerformanceProtocol.ts
---
Wave 1, builder: [[93c6971b]] of [[2a74de70]] — `src/PerformanceProtocol.ts`, 1,191 lines, one file to read whole.

Leads, to confirm or contradict from the code: what each of the nine record kinds is for and which producer writes it; why each list has a composite cursor of its own; the evidence every report carries — the inherited drop pair, this process's losses, the retained range — and what an absent record still says; the convention that a record is declared as a schema and its type derived from it, shared with the executions vocabulary [[0383211b]]; the payloads that mirror the executions records rather than re-spelling them.

Bind each claim to the narrowest sources that can contradict it — a symbol source on this file where the claim is about one schema — and verify only after reading all of them. `CpuProfile.ts` belongs to [[e4e8b32f]] and `schema.ts` to [[2fb06b87]]: reference them, do not claim over them.

Done when the claims stand verified, `run_doctor` over the file is clean and the review passes.