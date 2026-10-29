---
id: 01a1564f-f5fd-73dc-8a3d-31b0c20b1cca
title: Step 2 · A user's words become a rule about code that arrives exactly when the layer is touched, but stays text and is invisible on the Rules screen
ord: 16
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "confirmed"
  }
edges:
  - kind: validates
    to: 01a14c14-a11c-7ce8-9d84-632f2c5e9bd2
---
## Hypothesis

The user's words "code in `packages/domain` must not depend on the UI", said to a plain agent, become a rule about code: it reaches the agent on the first touch of a file in that layer, once per thread, does not weigh down startup, and stays text with no check.

## Setup

- law-lab at `12cfb2a`, Tagma is runlith at `887c1efb58`. The thread-researcher plays the agent, following Tagma's instructions for its agents: it records a norm about code as a #rule with a source on the place it touches.
- Recorded rule [[18ad9402]] in the law-lab graph: source — the `packages/domain` directory, `delivery` unset (a rule with sources is `code`).
- Touches from the runlith thread: `read` of `packages/domain/src/money.ts`, then `packages/ui/src/Amount.tsx`, then `packages/domain/src/budget.ts`.

## Observation

- The rule-recording reply: "start of a new tagma thread: unchanged" — a rule about code does not enter startup.
- The first domain file read brought the rule as the line `Rule 18ad9402 … [code · packages/domain]`. The ui file read brought nothing. The second read of another domain file brought nothing: the text arrives once per thread.
- law-lab `read_enforcement`: "1 rules, 0 enforced". The rule is text only; neither the rule record nor the agent instructions make a check of it.
- The Rules screen (`RulesPage.svelte`) builds rows only from rules with a check. A text rule shows only as a number in the header and the line "1 other rule carry no check; agents follow them as text.", with no name. By the code, the screen re-reads only on `enforce` and `remeasure` events, so it will show a new text rule after a reload — a conclusion from code, not checked on screen.

## Conclusion

Confirmed: the word becomes a rule about code, delivery on touch is exact — own layer, once, no startup cost. The product leads no further: the rule stays text, and the user does not see it on the Rules screen by name nor learns it can be made a check.

**What the user had to know or do on their own:** that their words must become a rule (a plain agent does that only when it reads them as a standing norm); where to find their rule afterwards — it is not on the Rules screen; that the next step is to ask for a check.
