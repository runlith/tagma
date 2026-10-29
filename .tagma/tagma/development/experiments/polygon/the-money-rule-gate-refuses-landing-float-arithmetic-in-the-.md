---
id: 01a135f9-b1a2-7637-ae25-edabcbf01f62
title: The money-rule gate refuses landing float arithmetic in the polygon and passes clean
ord: 2
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "confirmed"
  }
---
## Hypothesis

The polygon money rule, gated on `submit_work`, refuses a landing with float arithmetic in money with a `law-violated` refusal naming the file, line and exit path; a clean landing passes.

## Setup

- Polygon at commit `5c298d4` (`tools/money.js` + `tools/runners.json`: a program finding float literals and `Math.round`/`toFixed` in `src/*.ts`, except tests and `src/money.ts`).
- Polygon setting `enforcement.programs = tools`; rule `56e875f1` — `enforce_law` strictness `gate`, trigger `submit_work` before, binding `{ runner: "money", id: "float" }`.
- Set up and verified by a child homed in polygon: `write_setting` and `enforce_law` do not take `project` (reflection `e95c70f1`).
- Probe: the child writes a `* 0.1` line into `src/orders.ts` and calls `submit_work`, then removes it and lands a clean edit.

## Observation

- Thread `01a135f9-e01d-79ea-b3e7-f51c5c6b0eb7` (`gate-probe`, polygon home, `gpt-6.1-sol` high), about 3 minutes; full verbatim report in its scratch, `gate-probe-report.txt`.
- `enforce_law` measured the rule on `5c298d4` in 0.2 s: debt 0, revision `0d9587e49ec0`.
- Probe `const tax = subtotal * 0.1` in `src/orders.ts:29`: `submit_work` refused `law-violated` — named the rule, file, line, fingerprint and three exits (fix per the message, land clean paths separately, take into debt through `enforce_law` with an owning task). The refusal recorded in `read_enforcement`.
- After removing the line, the clean edit (`listOrders`) landed as commit `a5436a3`; 10 tests green (agent reports).
- `read_inspections` named the `tools/` program directory but did not list the `money` runner; `enforce_law` found it.
- A gate cannot be set from a runlith thread: `write_setting`, `enforce_law` and their reads do not take `project`, and the CLI from the polygon folder silently wrote the setting into runlith (reflection `e95c70f1`, task `762f1514`).

## Conclusion

A foreign project's gate, set by its child, refuses the violation at landing and passes the clean edit; the refusal reads without context and leads to the fix. Untested: a performer agent unaware of the probe meeting the refusal in an ordinary task; the refusal in the polygon interface through the operator's eyes; the program catches only syntactic float signs, not every violation of the rule.
