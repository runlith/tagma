---
id: 01a15999-729b-7cc3-be53-cd4a6258036f
title: Step 4 · A watch-mode check lets a violating commit through, names it to the author and records an escape with no debt growth
ord: 18
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "confirmed"
  }
edges:
  - kind: validates
    to: 01a14c14-a11c-7ce8-9d84-6334c46b6b5f
  - kind: validates
    to: 01a14c14-a11c-7ce8-9d84-63387548cc1d
---
## Hypothesis

Rule [[18ad9402]], made into the `Loading.forbid` check in `tagma.config.ts` with `watch` strictness before submit_work, lets a commit with a forbidden import through, names the violation to the author in the commit reply and records it as an escape, not as debt.

## Setup

- law-lab at `89b763f`, uncommitted `packages/domain/src/summary.ts` with `import { formatCents } from "@law-lab/ui"`. Tagma — the operator's live installation `20261020T112233875Z` (the [[b6f7a4e0]] rules surface).
- All calls from the runlith thread, no `tagma op`, no working-directory switch.
- `tagma.config.ts`: key `domain-no-ui`, `Loading.forbid({ from: ['packages/domain'], refuses: ['react', 'react/*', 'react-dom', 'react-dom/*', '@law-lab/ui', 'web'] })` — description taken from `read_inspections name: Loading.forbid` (about 2.6 thousand characters).
- Order: `check_rules inspection: domain-no-ui` over the change → config commit `f42f91d5c7` → `enforce_rule` watch, `on: submit_work before` → `summary.ts` commit `4d70624318`.

## Observation

- Trial judgement over the uncommitted config and `summary.ts` from another thread worked: one finding `packages/domain/src/summary.ts -> @law-lab/ui`, line 1, 0.3 s. The step-3 workaround no longer needed.
- Two required parameters (`from`, `refuses`) instead of seven; the rest is defaults.
- `enforce_rule` on HEAD with the config: debt 0 → 0, measurement 0.1 s.
- The `summary.ts` commit passed. In the submit_work reply — a `watched (1)` block with fingerprint, file, line and chain.
- `read_enforcement`: debt 0, `escaped 1` — `summary.ts:1 … @ 4d70624318`. `check_rules over: all` on HEAD finds the same violation.
- law-lab has no `@runlith/tagma`: neither in `node_modules` nor in npm (404). Tagma executes the config with its own doors, so judgement works, but the user's editor will not resolve the `@runlith/tagma/rules` import — no types, no hints.

## Conclusion

Confirmed: watch lets the commit through, names the violation to the author in the same reply and records the escape with the commit that introduced it; debt does not grow. The new surface closed both step-3 pains — check assembly and operation place.

Not checked: whether the escape is visible on the Rules screen and how a person, not an agent, will see it; the reply still does not explain why it is a violation or how to remove it — the "cut the chain" way out lives only in the function description.

**What the user had to know or do on their own:** that after `watch` the violation lands and must be looked up in `escaped`; `@runlith/tagma` cannot be installed for editor types — the package is not published.
