---
id: 01a0c4f7-923b-72db-a04a-6489cdb0314e
title: "GPT-5.6 Sol at max: the loop rewritten as a class, with the only nested stream owner"
ord: 3
---
Sol at max rewrote the loop itself as a class: 391 lines residual over two extracted files.

- **The cut.** `AgentStepCall` holds the step's injection across the overflow retry, with a private `AgentCallStream` inside it holding one stream's fold, buffer and titles; `AgentToolBatch` holds the prepared calls, the gates and the dependency edges behind a private constructor — the only batch in the field that genuinely holds them.
- **The residual became `AgentTurnLoop`.** The steps, the five faces and the latch moved from a closure into private fields of a class the same file defines: settlement was renamed, not rehoused, and 391 lines stand where Terra leaves 279.
- **The ports are narrow and nothing is handed back up.** The call sees `evaluate` alone, the batch `preflight` and `settle` alone — both as `Pick` slices of the door rather than named members.
- **A nested owner.** `AgentCallStream` is private to the call: the only entry to give the physical stream an owner beneath the logical one.
- **The retry moved down with its guard.** `run()` replaces an overflowed attempt inside the owner and refuses to retry once the abort is set, so the residual's abort path still answers the first attempt exactly as before.
- **The collision shipped**: a second `AgentToolOutcome` beside the door's own; `agentToolSources` stayed.
- **Its evidence is the order it believes it kept**, listed as a plan and backed by the 56-case turn suite, where [[ec59b0b6|Astra at high]] compared syntax trees and [[6095f747|Astra at low]] compared bytes.
