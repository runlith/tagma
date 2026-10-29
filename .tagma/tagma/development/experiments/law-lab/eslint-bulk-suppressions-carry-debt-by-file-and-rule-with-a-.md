---
id: 01a160c4-67ed-7962-bbff-ad514ce8617e
title: ESLint bulk suppressions carry debt by file and rule with a counter and judge only the new
ord: 21
tags: ["research"]
fields:
  {
    "source": {
      "name": "ESLint bulk suppressions",
      "ref": "https://eslint.org/docs/latest/use/suppressions (ESLint 9.24–10.1), read on 2026-10-21"
    }
  }
---
**Observation (from the docs, not from a run):**
- Since ESLint 9.24.0 `eslint --suppress-all` or `--suppress-rule <rule>` records standing violations into `eslint-suppressions.json` at the root — the violation count per file and rule; the file is committed, the rule is switched on as error and judges only the new.
- The counter compares by file and rule: when a file has more violations than recorded, ESLint shows all of them, not just the excess.
- A fixed recorded violation fails the run by default with an "unused suppressions" error until removed with `--prune-suppressions`; since 9.28.0 that is switched off with `--pass-on-unpruned-suppressions`.
- The Node API (since 10.1.0) only applies suppressions; creating and pruning them is CLI-only.
- oxlint has the same `--suppress-all` and `--prune-suppressions` flags; Rushstack has its own `.eslint-bulk-suppressions.json`, eslint-seatbelt has TSV.

**Conclusion:** debt by file and rule with a counter, refusal only for the new, and switching a rule on in a dirty project with no cleanup — a stock ESLint and oxlint feature, not Tagma's alone. A record has no owner, no history and no screen; removing a fixed one is a manual step.

**Not established:** how suppressions behave when a file is renamed and in merge conflicts of the suppressions file (the oxlint discussion mentions JSON conflicts).
