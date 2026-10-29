---
id: 01a15a16-e8b3-770b-ac40-23695402820c
title: "A rule violation shows everywhere as one finding: norm, place with the check phrase, and the fix the check itself gives"
ord: 5
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a159e7-85d5-71ad-9cb6-d4bcb495071b
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/contract/wire/findings.ts
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/contract/wire/enforcement.ts
    symbol: crossingOf
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/contract/wire/enforcement.ts
    symbol: generalFix
---
A violation is assembled into a finding once — `crossingOf` — and printed by one `findingLines` function. It serves the `submit_work` answer, the gate refusal, `check_rules`, the `git commit` hook, holder notifications and `read_enforcement`. The Rules screen shows refusals, debt and escapes with one `Findings` component and takes the place from the same file. A separate view at some other door would diverge again as before: that's how it happened — the rule was named by number, the place repeated three times, there was no hint.

**Finding parts.**
- Norm — the rule, its title and strictness. Printed once above that rule's violations.
- Place and check phrase — `file:line message`. `via` is added only when the chain has more than one link.
- The check gives `fix` from its own data: a builtin from parameters and the module map, a program and `Linters.command` from their own finding, SARIF from `fixes[].description`, Ruff from the fix message and the rule page. With no own `fix`, the finding has none. The shared escape from the function (`generalFix`: a builtin's `unblock`, for a program the pointer to fix the check-described problem at the named place, for a linter a phrase with the tool name) travels as a separate field on the finding, and `findingLines` prints it once under the norm: "fix:" when none has its own, "fix where a place names none:" when some do — then each own fix stands under its own place. Repeating the shared escape on every line was the noise that drowned a list of hundreds of refusals.

A fingerprint isn't printed in text: it's a debt key, not a description. `check_rules` fingerprints and a gate refusal's path that absorbs a crossing into debt name it.

**What is stored.** An escape in the rule document and a refusal in `rule_refusal` keep only what was said — the phrase with chain (`said`) and only the own `fix`; the shared escape is served once per rule by `read_enforcement` (`engine.generalFix`, `norm.generalFix`). A refusal's `reached` column is the place's import: before the check phrase, the refusal kept only it there, so the old record honestly shows one place, and the phrase lives in its own `said` column. The landing journal keeps `CarriedViolation` with default values for norm fields: a landing recorded by an older version replays, it doesn't park.
