---
id: 01a165a3-516e-7662-8b15-980d850a1b0b
title: Step 21 — config tightening, rule switch-off and delivery, formatter next to someone else's lines
ord: 39
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "unclear"
  }
---
**Hypothesis** — (a) a check tightened in `tagma.config.ts` is visible before landing and yields this commit's escapes after it; (b) a switched-off rule is not delivered and does not judge, enforce on it refuses; prompt/code delivery only changes where the text reaches agents; (c) a format command on a file with someone else's lines neither takes nor spoils them.

**Setup** — law-lab (project 39); rules [[54911d80]] (`Files.maxLines`), [[1f4c22f7]] (`Code.noReexports`, no sources), [[18ad9402]] (`Loading.forbid`, sources `packages/domain`); `format.prettier`. Second writer — child agent peer-header (Haiku) in law-lab. Caller — a thread with a runlith home.

**Observation**
- (a) Threshold 120 → 50 uncommitted: `check_rules` over change — "no violation" (judges changed files); over all with `inspection: size` — measures the HEAD config (120). `submit_work` (`6f29b791cd`) landed silently; after ~10 s escapes `seed.ts 56 > 50` and `expenses.ts 83 > 50` `@ 6f29b791cd`. Reflection [[8deaecb2]]. Threshold restored `73c526681f`.
- (b) `set_rule_enabled false` → the law's recall arrived on the next step; a re-export in `buttons.ts` — `check_rules` does not run the rule; `enforce_rule` → `rule-disabled`, but the unblock names `update_block` instead of `set_rule_enabled` (works, but past the owner). Switch-on — the law delivered again.
- `set_rule_delivery code` for a rule without sources → recall from the prompt, reading files does not deliver it, while the gate judges the whole project; the reply is silent. Reflection [[ddff721b]]. Restored to prompt.
- `set_rule_delivery prompt` for a rule with sources → law in the prompt, judgement coverage stayed `packages/domain`. Restored to code.
- (c) peer-header wrote the unformatted `HEADER` line; I — an unformatted `field(...)` below in the same file. `submit_work` without taking: "nothing to commit", my line took the HEAD shape, the neighbour's line stayed untouched and theirs (`read_changes`). With taking the neighbour: also "nothing to commit", their line formatted to HEAD, no holders.

**Conclusion** — (b, c) confirmed; (a) works but is invisible before landing. Defects handed off: config-tighten and rule-switch-words. Not checked: `commit_checkout` on the operator's behalf (needs their word).
