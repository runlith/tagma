---
id: 01a15ac8-291c-7e3d-a747-bb56ff87f928
title: commit_checkout in a freshly registered clone landed a new gate-rule crossing instead of a law-violated refusal
ord: 65
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15a84-795a-7d9d-a265-2c12ba8db0e1",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15a8d-6750-7ee2-8532-e76f4824f92a
---
Noticed while checking [[4824f92a]] on a separate `tagma:try` (root `/tmp/refusals-ux-try`, build `cc41943e19-dirty`). A runlith clone (`git clone --shared`, no `node_modules`) was added as project `runlith-try` with `team` storage; the clone staged a new file `apps/tagma/server/src/platform/reachDemo.ts` with imports of `../enforcement/engineVoice.js` and `../threads/journal/base.js`. Operator `tagma op commit_checkout --yes` (CLI with no thread) answered `ok` and created commit `0fdf7937`, although [[083d37f1]] stands at gate before submit_work, and `check_rules over: "all"` right after found both crossings (`platform -> enforcement`, `platform -> threads`). After the commit the commit write queue fell on project programs (`Cannot find module '@runlith/code-facts/adapters'` — the clone has no dependencies), no escapes appeared, the rule had no measurement in that checkout.

Cause not established: not checked whether `commit_checkout` judged the index at all, whether the trigger index saw the just-registered project, or whether a program failure turned into a skip instead of `inspection-failed`.

**Outcome (9d03d38ffa).** The premise was wrong: an operator commit through `commit_checkout` lands without judgment by decision b87fa15e60, and what is skipped is written as an escape for the operator; only a thread commit refuses. The real defect: writing a landed commit in the queue failed wholesale when any rule's inspection over it failed: no escapes were written for any rule, and the project queue stood behind that commit. Now one rule's inspection failure is only logged. Its violations will be recorded by that rule's next measurement, already holderless. A repeat commit is still held only by whole failures: no tree, refusal, key not described by config. The `commit_checkout` grammar, the `rules` skill and the [[cb6e09e1]] feature are fixed. Proof — a stest in `ownGit.stest.ts`, red without the fix. Not proved: that the "a thread of another project committing here" stest in `commitChecks.stest.ts` fails (expects `law-unread`, gets a successful answer) for reasons other than this fix. This fix doesn't touch staged-court code.

What to do: reproduce on a fixture (fresh project, gate modules rule, `commit_checkout` with a crossing), find where the court let the landing through, fix at the owner. Proof — an itest: such a `commit_checkout` refuses `law-violated` and commits nothing.
