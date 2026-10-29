---
id: 01a15242-d7b8-75cd-adc7-b2b5b5059c61
title: Compaction passes over the whole selected history run in the owner's worker, not on the event loop
ord: 28
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a151df-e920-73d7-9b09-09da716be568
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadCompaction.ts
---
An ordinary step no longer walks history ([[716be568]], [[84232f86]]), but compaction itself walks the whole selected history synchronously on the event loop. That is against [[7a910861]]: cost grows with history with no upper bound.

## Measurement (2026-10-19)

The measurement is single, on one machine, and the experiment was not kept: the `packages/agent/compactionProbe.ts` probe was removed after measurement. Machine — Apple M2 Max, one sample under load (load average ~20, six agents in parallel), so timing is inflated and noisy. Synthetic history of "user → tool call → ~1200-char result → answer" turns. The summarizer model is a stub answering instantly, so only synchronous time was measured. Manual compaction via `prepare` with `requested`, on the core meter cache (`compactor.meter()`).

| history | compaction, meter already saw history | compaction, cold meter | first ordinary step after restart |
|---|---|---|---|
| 4,000 messages, 1.8 MB, ~450k tokens | 15–21 ms (mean of 20 repeats 15.5 ms) | 85–95 ms | 60–95 ms |
| 10,000 messages, 4.6 MB, ~1.1M tokens | 56–87 ms (mean of 10 repeats 56 ms) | 180 ms | 148 ms |

Passes of one compaction over the whole history, by code: the prune index (full only on a new line), `rawSize` twice (prices from cache), `selectThreadCompactionPrefix`, serialization of every message into `sizedSegment` and again into the summary prompt text, `threadCheckpointHead`, meter running-prefix recomputation after folding, `historyPrefixHash` in `foldSettlement`: `JSON.stringify` and sha256 of the covered prefix and again of the whole history if the fold carries prune. About ten passes total, three–four of them serializing content. The message-property read counter for one compaction is ~24 per message.

CPU profile of a warm compaction on 4,000 messages:
- `historyPrefixHash` (`JSON.stringify` and sha256) — about 45%;
- meter: new-head digest and prefix recomputation — about 20%;
- summary prompt text — about 12%;
- prune and boundary choice — the rest.

The cold case and the first step after restart are almost entirely meter hashing — that is [[eeb8d7a5]].

**Weak machine.** Single-thread performance of the weakest Mac or Linux laptop Tagma will reach is roughly 3–4x below the M2 Max — that is an estimate, not a measurement.
- ~450k tokens: warm compaction 50–80 ms.
- ~1M tokens: 170–350 ms.
- Cold: 300–700 ms.

Even halving the cost, a 1M-token window on a weak machine does not fit ~50 ms.

## Proposed design

**1. First cut the cost at the owners, with no worker.**
- **Settlement.** The prefix hash comes from the meter's running digest (`MessagePrefix.digest` by index), not `JSON.stringify` of history. The meter already holds it over every message's content, and `covers` checks history under lock with the same digest. The `coveredPrefixHash` format changes. That is the checkpoint-write idempotency key, not a check against old rows, so old checkpoints stay. A repeat of a write started before the upgrade gets a new hash and may write a second checkpoint. That needs checking or a step decision.
- **Summary.** Message text serializes once: a cache by message identity, shared by `sizedSegment` and the prompt.
- Expected about −55% of warm compaction.

**2. An execution port in a worker for what remains.** What remains is serializing the segment into summary text (by volume that is the summarizer request itself) and boundary-choice passes.
- The core declares a `CompactionWork` port with one pure operation: history and fold parameters → boundary, prompt text, sizes.
- The server fills the port with its worker.
- History travels to the worker in encoded schema form: `Schema.encode` of `Message` gives plain JSON, picture bytes go as transferable buffers.
- With no port — e.g. in core tests and conformance — the work runs in place.
- Price: encoding and structured clone are also O(volume) on the main thread. The win is the gap between serializing-with-hashing and copying, roughly 2–3x, not zero. If point 1 goes first, the worker is needed only for windows from ~500k tokens on weak machines.

## Decision

Point 1 is built (commit `3e5402998c`), point 2 is not built: the agent-layer lead writes the `CompactionWork` port spec from the numbers below. Proof of point 1 is a test in `ThreadCompactionStep.test.ts`: compacting a long history reads every message for serialization once and never serializes history whole (property-read counter, not time).

Changing the `coveredPrefixHash` format is safe: a repeat of a checkpoint write started before server upgrade is impossible. Settlement with that hash lives only in process memory. The keyed `compaction-settle:<id>` transition returns the stored outcome on repeat before the participant starts. Native adopt does not pick up compaction runs after restart: they end as interrupted. So a write in the old format never repeats after upgrade, and no second checkpoint lands on the same boundary.

## Measurement after point 1 and [[eeb8d7a5]] (2026-10-19)

Same machine and same synthetic history, one sample under load; the probe removed again. "First step after restart" is `requestHashed` of a fresh meter over history re-read from JSON; with [[eeb8d7a5]] its messages carry stored digest and price.

| history | compaction, meter already saw history | compaction with fresh mass prune | first step after restart: hashing / stored measure |
|---|---|---|---|
| 4,000 messages, 1.8 MB | 3–5 ms wall, 5–9 ms CPU | 12 ms | ~250 ms CPU / 8–11 ms CPU |
| 10,000 messages, 4.6 MB | 5–7 ms wall, 7–8 ms CPU | 53 ms | ~430 ms CPU / 21–27 ms CPU |

Hashing in the restart column costs more than in the first measurement (148 ms) because the machine was loaded harder; compare pairs inside one run.

**Remainder for a weak machine** (3–4x slower, estimate):
- warm compaction at ~1M tokens — 20–30 ms, fits ~50 ms;
- first step after restart on 10,000 messages: ~2 ms on warmed code, estimated ~6–8 ms on a weak machine (rechecked in [[4a12819d]]). The earlier 65–110 ms figure and the "chained sha256 in JS" explanation are wrong: on the server `@runlith/utils/sha256` is native `createHash`, the chain costs 0.35–0.5 ms, and 21–27 ms was a single cold call with JIT warmup paid once per process;
- fresh mass prune — 160–210 ms: prune builds new message objects, and the meter re-hashes them; that hashing goes in a batch through `sha256Batch` and yields the loop between chunks;
- record writing computes digest and price only for the step's new messages; a whole history passes it only at `seed`.
