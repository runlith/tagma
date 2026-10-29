---
id: 01a0daf7-4a8b-74b5-8953-75b9cd95a677
title: "A trace is judged in units: a declared unit keeps its own subtree when it fails or runs slow against its name, a stall keeps only what ran across it, and a long root is judged window by window"
ord: 130
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/agent/spans.ts
---
**1. Outcome.** A slow or failed tool call or model step inside a long run keeps its own spans. Its subtree is whole, so `breakdown` on it says where the time went. Its run is not kept whole for it. A stall keeps what ran across it, not the rest of every run it touched. The process submits fewer records, and each span costs no more tracer time than before.

**2. Problem and evidence.** Incident: a `read_output` call (`wait: 300`) in run `01a0daa4-…` of thread `01a0d591-…` ran 86.4 s. Its command had ended 3 s before the call did. `read_performance slow` for `read_output`, `CommandOutput.read` and `Terminals.commandWait` answered nothing. The run's spans were already forgotten. Two retained runs show the opposite failure: run `01a0da9d-…`, 38 minutes long, stored 158,077 spans under trace `d3e266bf…`. The hash did not choose that id (FNV-1a mod 100 = 75), so a stall reversal kept everything the run did after it. Stalls over 100 ms arrive about every 30 s under load (20 in ten minutes of 2026-09-25 22:00 UTC).

**3. What holds now.** The code is `TraceSampler` and `PerformanceTracer`.
- One verdict governs a trace. It is taken when the root ends, when no span is open, or at `TRACE_BUFFER_MS` (2 s) or `TRACE_BUFFER_BYTES` (256 KB) — measured only when a span ends ([[58efd7a4]]).
- Every span ending after the verdict follows it ([[ee35a4e1]]). After `dropped`, it is forgotten. After a keep, it is streamed.
- Only a root is judged slow, against its name's p99 or `SLOW_ROOT_MS` 250 ([[93af43de]]).
- A stall reverses a dropped trace while it is still in the map. The map holds every trace with an open span, so a long run is reversed by any stall and streams all its later spans ([[8ba50f23]]).
- So a root outliving 2 s is never judged slow. A failure after 2 s is never kept. A long run is kept either not at all or from its first stall to its end.

**4. Target model.** A trace's spans are judged in **units**.
- **What a unit is.** A unit is a span plus every span under it that is not inside a nested unit. The trace's local root heads the root unit. Any other span heads a nested unit when its producer opens it with the `JudgedUnit` annotation. A span belongs to the nearest unit around it.
- **Nested unit verdict.** A nested unit is held until its head span ends. Then it is judged on itself, first reason wins: `failed` (a member ended failed, interruption alone excepted), `slow` (its head above its own name's running p99 bucket bound — no absolute ceiling, since a model step or a tool call is never under 250 ms). A kept unit is handed over whole. A unit that is not kept hands over what ran across a stall and **joins** the rest to the unit around it. So the enclosing unit's breakdown stays whole if that unit is kept, and the spans die with it if not.
- **A stall keeps what ran across it, not the unit.** A span whose lifetime overlaps a named stall is handed over under `stalled` together with its ancestors held beside it, up to its unit's head; the rest of that unit or window is judged as if no stall happened. A span that ended before the stall was named is found where it is still held — an open unit, the open window or the dropped window held until the next deadline; a span still open when the stall is named is marked at its end. Being open across a stall no longer keeps a whole unit: a model step lasts seconds and a stall comes every few tens of seconds, so nearly every step was kept whole with every query under it.
- **The root unit is judged in windows.** A window closes when a local root ends, when no span of the trace is open, or at the time or byte bound. Its verdict is `failed`, `slow` (a root ended slow), `hash` (the head verdict), else `dropped`; a dropped window first hands over what ran across a stall.
  - While a root stays open, the next window opens at once.
  - A dropped window's spans are held until the trace's next deadline, so a stall named late still finds those that ran across it.
  - Once every local root has ended, the last verdict governs the late spans, as [[ee35a4e1]] does today.
- **The hash keeps the whole trace.** Every window of a hash-chosen trace is kept, and every unit that joins it.
- **Late members.** A member of a nested unit that ends after the unit's verdict follows it. Kept: submitted alone. Joined: placed in the unit it joined. Dropped: forgotten.
- **Nested unit bound.** A nested unit is held under the same byte bound as a window. Past it, the unit is decided on what it has shown: `failed` keeps it, otherwise what ran across a stall is handed over, the rest is forgotten, and so are its later members except those that run across a stall.
- **Declaration.** The declaration is a `Context.Reference<boolean>` keyed `@runlith/performance/JudgedUnit`. It is exported with a ready annotation `judgedUnit` through a new door, `@runlith/performance/unit`, which imports only `effect/Context`. Effect hands span annotations to `Tracer.span` at creation, so membership is fixed before any child exists. The kernel opens every member of its span vocabulary with it, so every `agent.*` span below the run is a unit. The run is a root.

**5. Owners and boundaries.**
- `packages/performance`: the sampler owns units, windows, joins and verdicts. The tracer owns membership, the declaration read and slowness. The new door owns the declaration.
- `packages/agent/src/agent/spans.ts` declares the kernel's units. The kernel gains a dependency on `@runlith/performance` — that door alone — and the depends-on edge [[d1caad35]] → [[2a74de70]].
- Nothing in the store, the reports, the record shape or the settings changes.

**6. Rejected.**
- *A root per call* (tool call and step open their own trace). It loses the run as the parent of its calls. It still needs a root that outlives the 2 s bound to be judged at its end. And the 250 ms ceiling would keep every model step.
- *Judging every span against its own p99.* That keeps about 1 % of every name, the hottest included, and the tracer pays a histogram read per span.
- *A unit list by span name in the tracer's options.* It is a special case per name in the composition, and it drifts from the producer.
- *A string attribute read after creation.* Effect sets attributes after `Tracer.span` returns, and the key would be untyped.
- *Raising the hash share or the time bound.* That buys volume, not the slow call.

**7. Acceptance.**
- (a) In a sampler test with no hash keep and no stall, one outcome per call: a failed unit and a unit above its name's p99, both ending minutes after the root's first window, are each handed over whole under their own keep; the run's other units, and its root-unit spans outside the kept windows, are not.
- (b) A stall keeps the spans that ran across it and their ancestors up to their unit, and no other span of that unit or window.
- (c) A unit that is not kept inside a kept enclosing unit appears in that unit's handover.
- (d) A hash-kept trace hands over every span it ends.
- (e) A root ending slow or failed within its first window keeps that window's whole trace, as today.
- (f) The kernel's `agent.*` spans below the run carry the annotation.
- (g) `traceKeeping.bench.ts` shows records and bytes submitted no higher than the baseline in both arms, and tracer CPU per ended span no higher than the baseline within noise.
- (h) The typecheck and the unit and integration layers pass for `performance`, `agent` and `apps/tagma/server`.

**8. Claims and tasks.**
- In [[d6c0265b]], the area body and these claims are rewritten from the code: [[58efd7a4]], [[ee35a4e1]], [[93af43de]], [[8ba50f23]], [[a290b2bc]], [[5f87d3d3]], [[831708d7]].
- New claims record the unit, the join, the window and the declaration door.
- [[e1a4e162]] (the doors) and the kernel's span claim [[4fc33b15]] are revised.
- The performance skill's coverage paragraph is rewritten.
- No task stands open on this.

**9. Order.**
1. Baseline bench.
2. Declaration door.
3. Tracer membership and slowness.
4. Sampler units and windows.
5. Sampler unit tests; revise the tracer itests that pin the old whole-trace streaming.
6. Kernel declaration and dependency.
7. Bench after.
8. Claims, skill, review, commit.

**10. Contract.**
- `SampledSpan` gains `unit: string | null`.
- `TraceSampler` gains `openUnit(traceId, producer, unit, enclosing)`, and `open` takes `root` and `unit`. Only the tracer and tests call them.
- `TraceSamplerCounts` keeps its shape; its counts become per window and per unit.
- The new door is additive.

**11. Stored data.** out: record shapes are unchanged. Records from before read the same.

**12. Who may do what.** out: nothing is authorized here.

**13. Long-lived things.**
- A unit record lives from its head's open until its verdict with no member open.
- A trace record lives while a span is open, as today.
- A head that never ends holds at most one byte bound of spans until the process ends. A trace with a leaked span already stays in the map today.
- The stall walk visits traces and open units.

**14. Bounded resources.**
- Held bytes are bounded per window and per open unit by `TRACE_BUFFER_BYTES`.
- The worst case is (open traces + open units) × 256 KB. A read_output call holds about 77 spans, about 25 KB.
- Nothing global bounds concurrency, as today.

**15. Rollout.** The running server keeps the old sampler until it is restarted on a build carrying this. Nothing persisted changes.

**16. Failures.** A restart loses held spans, as today. A unit whose trace record is gone places its late spans in the root unit.

**17. Observability.**
- `traceKeeping.bench.ts` measures records, bytes and tracer CPU per ended span over a synthetic long-run workload, with and without stalls.
- In production, `read_performance slow` for `agent.tool-call` answers kept units whose parent is absent, and the trace forest shows them as roots.


**Divergences found in building and review.**
- *(g) fails in the no-stall arm.* Three interleaved rounds, median of 5 runs each:

  | | Baseline | After |
  |---|---|---|
  | **No stall** | | |
  | Records | ≈1,490–1,550 | ≈1,810–1,910 |
  | Bytes | 0.50 MiB | 0.60–0.62 MiB |
  | CPU per ended span | 0.76–1.33 µs | 1.05–1.53 µs (ranges overlap) |
  | Loop wall per ended span | 0.68–0.78 µs | 0.75–0.79 µs |
  | **Stall every 30 s** | | |
  | Records | ≈52,050 | ≈10,220 |
  | Bytes | 17.1 MiB | 3.35 MiB |
  | CPU per ended span | 1.75–1.86 µs | 1.21–1.76 µs |
  | Loop wall per ended span | 0.97–1.10 µs | 0.89–0.93 µs |

  The added no-stall records are the kept units themselves: 4 slow or failed tool calls, 4 model steps and their query children. Any model that keeps the slow call adds them. Whether that is acceptable against "records must not grow" is the operator's call.
- *A root's slowness keeps only a trace that ended within its first window* ([[59dff5dc]]). A root outliving a window is past the 250 ms ceiling by construction. Keeping its final window added one window per long run and no evidence. With several local roots under one trace id, only the first window can be kept as slow.
- *A unit decided `dropped` at the byte bound hands over its head alone* when the head ends failed or slow ([[38672ce9]]). This was added so a call larger than 256 KB still answers `slow` on its name.
- *A nested unit counts as open in its enclosing unit* ([[0dff2dfe]]). Otherwise a late member of a joined unit lost the enclosing verdict.
- *§13 and §14.* A trace holds up to two windows — the current one and the held dropped one — so the worst case is (2 × open traces + open units) × 256 KB. A unit's record retires once its head, members and nested units have ended. A span forked from a unit and opened after that falls to the root unit's window ([[ee35a4e1]]).
- *Slowness limits* ([[93af43de]]):
  - Until a name has about 100 endings, no head is past its p99, and every process restart starts that count again.
  - All tools share `agent.tool-call`, so a call is slow against all tools rather than its own.
- *Not measured:*
  - a dense-run arm (the incident run had about 69 spans/s; the benchmark about 6);
  - nested units deeper than one;
  - the real store's shedding under a failure burst;
  - the per-head p99 read in isolation.
- *A stall keeps only what ran across it* ([[ae07ab15]], operator's decision). `traceKeeping.bench.ts`, one sample on the operator's machine, three interleaved rounds of the old and new sampler, median of 5 runs each:

  | | Before | After |
  |---|---|---|
  | Stall every 30 s: records | 10,024–10,099 | 3,213–3,336 |
  | Stall every 30 s: bytes | 3.30–3.32 MiB | 1.05–1.09 MiB |
  | No stall: records | 1,715–1,775 | 1,700–1,741 |
  | No stall: bytes | 0.56–0.58 MiB | 0.55–0.57 MiB |

  Tracer CPU per ended span moved within noise (1.78–2.00 µs before, 1.56–2.05 µs after in the stall arm). The benchmark's simulated work goes on through a stall, so it keeps more spans per stall than a frozen loop would.
