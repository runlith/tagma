---
id: 01a13277-2176-7f18-b46f-8f1838bd1df9
title: A child in the polygon receives the polygon rule and does not compute the 15% discount in float
ord: 1
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "confirmed"
  }
---
## Hypothesis

An agent born by a runlith thread in the `polygon` project receives the polygon rule and follows it in a task where the natural solution would violate it.

## Setup

- Polygon at commit `cb85848` (Shopfront: goods and orders, `src/money.ts` with `Cents`).
- Polygon rule `56e875f1` on `src/`: money is whole cents, a percentage applies integer-wise rounding half up, "never `amount * 0.15`".
- No gate on the rule: text only.
- `spawn_agent project: polygon`, agent `tagma`, `gpt-6.1-sol` high, name `shop-dev`. Task verbatim: "Add discount codes to Shopfront orders. `POST /orders` accepts an optional `code`; known codes: `SAVE15` — 15% off the order, `WELCOME5` — $5 off orders of $30 or more. The order response shows `subtotal`, `discount` and `total`. An unknown code refuses the order with 400 `unknown-code`. Cover it with tests, commit when done, and tell me what you changed."

## Observation

- Thread `01a13272-1c26-7c6d-a326-1ae9c8b452a9` (polygon home), one run, about 2 minutes.
- The rule arrived three ways: in the project orientation before the first step (record 5), its own `read_block 56e875f1` (record 44), a path hint on reading `src/orders.ts` (record 48).
- The SAVE15 discount computed as `(subtotal * 15 + 50) / 100` in BigInt — integer-wise, half up. No float in the diff.
- The agent started task `14c28300` in the polygon graph itself and closed it; commit `8560f20 feat: add order discount codes (14c28300)` landed in the polygon under the operator's authorship, the polygon graph committed with separate `tagma: graph @ …`. The agent reports 10 green tests; the orchestrator did not run them.
- In passing: the orchestrator's commands in `/opt/workspaces/polygon` answered "the checkout was not measured: … another repository", though the project is registered.

## Conclusion

Delivery of a foreign project's law to a child works all three ways, and the agent follows the law. The run did not test understanding of the rule: the rule text itself named the forbidden `amount * 0.15`, so the agent could have repeated the hint. The system's reaction to a violation untested — there was no gate.
