---
id: 01a0c4f7-924d-7d00-ad24-06306095f747
title: "GPT-6 Astra at low: byte-identical relocation, with the whole tool phase left where it was"
ord: 4
---
Astra at low relocates rather than rewrites: two owners, a 533-line residual, and the cleanest proof that nothing moved.

- **The cut.** `TurnResult` holds the steps, the five faces and the closed latch; `ModelAttempt` holds the per-call stream state and the injection. The whole tool phase — preflight, the path-dependency rules, the completion gates, the fan-out — stayed where it was, which is why only Muse at xhigh and the two lower [[95b83755|Fable]] runs leave more behind.
- **Dependencies are named**, in two explicit sets composed as `AgentTurnDeps`, and no second `AgentToolOutcome` is exported: the type stayed private, so the collision four other contestants shipped never arose here.
- **One weakness in the ports.** `modelAttempt(deps, steps)` takes the ledger's live array to read the previous step, where Terra passes that step by value; and the door arrives as `Pick<AgentToolDoor, 'evaluate'>`, a hand-cut slice of another owner's contract.
- **The proof is the best in the field.** Eleven source ranges were compared against the pinned original and reported byte-identical, and the two failing workflow tests were measured again with the original file restored.
- **Cost.** 4:16 and 5.8k written tokens — the cheapest run of the nine, produced by a relocation script rather than by writing the modules.
