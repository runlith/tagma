---
id: 01a145ce-8776-7570-a889-5a5420e2428d
title: Context estimation stands on the thread's latest measurement while the message prefix matches, and the uncovered rest is estimated from the thread's own ratio
ord: 6
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a145ce-5070-7faf-8412-78c62f1c1475
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadCompaction.ts
  - kind: symbol
    ref: packages/agent/src/thread/compaction/calibration.ts
    symbol: measuredWeight
  - kind: symbol
    ref: packages/agent/src/thread/compaction/ThreadRequestMeter.ts
    symbol: ThreadRequestMeter.estimate
---
Context estimation stands on the thread's latest measurement while the message prefix matches; the uncovered rest is estimated from the thread's own ratio. A raw estimate (chars/4) diverges from the provider tokenizer differently per content: code and tool output, JSON schemas, Cyrillic. A model's learned weight, averaged over all threads, can miss a single thread by tens of percent — and at the compaction trigger that means compacting long before the threshold. So estimation holds to the thread's latest measurement and its own ratio.

- **Anchor.** The measurement (`inputTokens` + footprint) stays the anchor while the message-prefix digest matches. A prompt or tool-set change is no discard: new prompt and tools missing from the measurement are estimated, vanished ones and the old prompt stay inside the measurement. Re-estimation is thus limited to what changed in size. A `prompt`/`tools` `basis` means "anchor kept, this part changed".
- **The thread's ratio.** Everything the measurement does not cover is estimated from measured / covered of that same measurement within calibration bounds — tail, new tools, and requests the same `prepare` no longer covers: after a new prune, after media omission, after every fold in the compaction loop. When a pruned request no longer proves the prefix, the ratio is taken from the stored history the measurement was taken on.
- **Ratio denominator** is the raw of what the measured request carried: a replaced prompt counts at its replacement's size, otherwise the old prompt inside measured with no covered pair would inflate the ratio and return a false compaction. Raw of vanished tools is unknown (footprint holds only their digest), so their share overstates the ratio — an early-compaction-side error, bounded by that share.
- **A deferred tool offered by one name** carries a footprint digest distinct from its full-definition digest: a reveal after measurement is estimated by the full definition, not counted as covered by the measurement that paid for the name.
- **The model weight** (learned or baseline) applies only when the thread has no measurement on this model: a new thread, a model switch, stale reads after rewind, a rewritten prefix and stored history.

Without this, any lost exact match turned estimation into raw × model weight — the jump that caused the false compactions.
