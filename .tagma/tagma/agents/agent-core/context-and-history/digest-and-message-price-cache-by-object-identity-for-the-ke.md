---
id: 01a14049-4fed-7f1c-804c-74e704cb2fd8
title: "Digest and message price cache by object identity for the kernel's whole compaction: history messages never mutate in place"
ord: 5
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/agent/src/thread/compaction/ThreadRequestMeter.ts
    symbol: MeteredParts
---
`MeteredParts` lives as long as `makeThreadCompaction` and is shared across all threads and runs: a run's meter takes it through `compactor.meter()`. A thread's new run hashes only messages the cache has not seen. Objects of the held history are the same between runs (`HeldHistories`, keyed by `Object.is`); without the shared cache every run would re-serialize and re-hash the whole history: ~15 ms CPU per MB, on the main thread.

The key is the part or message object identity. So the cache is sound only while history never mutates objects in place: fold, prune, media, hydrate, and entry writes build new `Message` and keep references to the untouched. In-place mutation would hand a stale digest and price not to one run but to all.

The message-prefix digest is sha256 over the running message digests. The meter computes it lazily, with one hash per request: on prefix rebuild after a fold there is no per-message hashing. The same digest is the covered-prefix checkpoint hash (`coveredPrefixHash`) and the `covers` check of settlement under the lock (`ThreadRequestMeter.prefixDigest`), so compaction never serializes history for the hash. `coveredPrefixHash` is only an in-process idempotence key for the checkpoint write: a settlement with it lives in memory and is not repeated after a restart.

Price depends only on the policy's `imageTokens`, and the price cache checks it. Digest depends on nothing. Model correction (`calibration.correct`) is computed outside the cache.

Message digest and price survive a restart in the `thread_history_item` columns: the history entry measures new messages via `measureMessages` (the same batched sha256 as the meter), and load hands them back to the same objects via `recallMessageMeasure`, so the first run after a restart never serializes stored messages. Only the `imageTokens`-independent price is stored: a message with a picture gets an empty one and is measured again. A stored measure applies only when the shape step did not change the message on load — otherwise it would describe the earlier shape. A row without columns (written earlier) hashes as before.
