---
id: 01a0c99b-43ca-7d17-98d6-f72e0ef3e10f
title: A composition's part rows can sum to less than the total they break down, while the file and its test name both promise they sum
ord: 120
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/thread/composition/requestComposition.test.ts
  - kind: file
    ref: packages/agent/src/thread/composition/requestComposition.ts
---
A composition prices each part by its share of the measured characters: `Math.round((size / measuredChars) * total)`, once per part, each rounding on its own. Independently rounded shares do not reliably add up to the figure they are shares of. A billed total of 100 split three ways comes back as 32, 32 and 35 — ninety-nine.

The file promises otherwise in two places. Its header says the parts are priced against the provider's own last billed input "so the rows sum to the figure a reader" sees. And the note above `sizeOf` explains that it answers characters rather than tokens precisely because a token figure per part "would round eleven times and stop summing to it" — naming the hazard as the reason for one decision while the pricing step commits it anyway.

Nothing catches it. The test named for the invariant pins a single fixture whose numbers happen to divide evenly, so it passes and will keep passing; a reader of the test list sees the invariant asserted and it is not.

What a reader of the product sees is a breakdown that does not add up to the total above it. That is small, and it may be the right trade — exact reconciliation costs either a largest-remainder pass or a visible rounding row, and neither is free. But the choice has not been made anywhere: the code rounds naively, the comments promise exactness, and the test's name claims it.

Done when the rows either sum to the total, or the code and whatever a reader is shown both say plainly that they are approximate — and when the test that carries the invariant's name either proves it across uneven splits or is renamed to what it pins.
