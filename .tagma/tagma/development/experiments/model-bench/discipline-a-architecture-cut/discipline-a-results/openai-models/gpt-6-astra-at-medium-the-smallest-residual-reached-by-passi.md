---
id: 01a0c4f7-9250-79aa-a1f8-ffdecf9e29d1
title: "GPT-6 Astra at medium: the smallest residual, reached by passing the whole session down"
ord: 5
---
Astra at medium leaves the smallest residual of the field — 158 lines over three owners — and pays for it by handing every owner the same bag.

- **The cut.** `TurnSession` holds the steps, the five faces, the closed latch and the stop conditions; `ModelStep` holds the per-step injection; `ToolBatch` holds the prepared calls. The residual is sequencing and nothing else, which is the shape the brief was asking for.
- **The bag.** `turnSession` returns `deps` alongside its state, and both new owners are constructed from that session, so a tool batch is handed the model projector and a model step is handed the stop conditions. No signature says what either one needs; the mechanism the cut was meant to open travelled downward intact.
- **A second `AgentToolOutcome`** is exported from `TurnSession`, beside the exported type of that name in `AgentToolDoor`.
- **The code was not written, it was sliced.** A script — `cut.py`, then `cut.cjs` — moved line ranges into the new files; two typed edits repaired what the script broke. 5:46 and 6.8k written tokens against Opus's 80k.
- **What that buys.** Relocated bodies are byte-identical, which is the strongest available evidence for a shape-only change; what it costs is that the cut is decided once, in advance, and never revised against the code.
