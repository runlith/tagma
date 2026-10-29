---
id: 01a0c4f7-9238-7c39-b020-ae90ec59b0b6
title: "GPT-6 Astra at high: declarations moved down, and the only proof that reads the exported surface"
ord: 1
---
Astra at high is the best of its line: two owners, a 301-line residual, and no bag handed downward.

- **The cut.** `AgentModelStep` holds the step's injection across an attempt and its overflow retry, and each attempt's stream state; `AgentToolBatch` holds the prepared calls and their completion edges. Settlement stayed above: the steps, the five faces and the closed latch remain in the residual, which is why 301 lines stand where Terra leaves 279 and Opus 200.
- **Declarations moved down, and the composition reads them back.** `AgentTurnDeps` is now the intersection of the two owners' own dependency sets plus what the residual keeps — the opposite of [[cf9e29d1|Astra at medium]], which reached a smaller residual by handing every owner the whole session.
- **The history is read, not ported.** The model owner receives the committed steps as a readonly array with a comment saying no callback into the turn is needed — the trap [[867f6f8a|Luna at max]] fell into.
- **Both owners slice the door.** `Pick<AgentToolDoor, 'evaluate'>` and `Pick<AgentToolDoor, 'preflight' | 'settle'>` cut fragments out of another owner's contract, where Terra and Opus name the members through indexed access.
- **The proof is structural.** An AST comparison reported 28 moved bodies identical and five public exports assignable both ways — the only contestant to check the exported surface rather than the text.
- **`agentToolSources` stayed**, as everywhere but Opus, and a second `AgentToolOutcome` is exported beside `AgentToolDoor`'s own.
