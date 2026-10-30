---
id: 01a14c14-a11c-7ce8-9d84-633958074d0c
title: The Rules screen shows the operator what Tagma checks and what slipped through, and lets them decide strictness
ord: 6
tags: ["feature"]
fields:
  {
    "state": "partial"
  }
edges:
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-633c89123986
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/rules
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/engineReading.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/engines.ts
---
**Value.** An operator who doesn't read code sees the project's rules state and decides how strictly to hold them: what is checked, what slipped through, what debt and with whom, which commits were refused. In an empty project the screen shows where to start.

**How.** The Rules screen (a place in the rail's "…" or pinned); the rule page; the `read_enforcement`, `enforce_rule`, `read_config`, `check_rules` operations.

**Behaviour.**
- Strictness is everywhere named by word: Blocks, Warns, Text. The list groups rules by their check's concern; rules without a check stand in "Followed as text", switched-off ones dimmed. The row tail shows one main thing: a recent refusal, a slip-through, known debt with an arrow, "not checked", "switched off", or "clean". The header shows the counts of rules, checked, slipped-through, and known debt.
- A graph with only text rules can be read without a git checkout. A project without a single rule shows the "Ask Tagma" entry (a thread with a ready question the human sends), "Write one yourself", and example norms.
- The rule page starts with the strictness switch. Moving to Warns or Blocks without a pre-landing trigger adds one, so the screen's promise holds true. Under Blocks, while slipped-through violations stand, and via "Keep as known…", the screen asks one decision for all: keep as known debt on a new task under the rule, ask an agent to fix, or forbid only new ones.
- Below the switch — only lists that have rows: slipped-through violations first, with place, essence, hint, and commit; debt by owners, where the header says how much the debt grew or fell on the last change; refused commits. When nothing slipped through and nothing is known, one line says there are no violations or that this copy isn't measured yet; a check that can't run says so in the same place regardless of lists. The rule's shared hint stands in an expanded line that has none of its own. "Open file" and the agent thread open in the copy whose branch the screen shows. "What it checks" is collapsed under the lists and names the reach in its line; expanded — what the check holds, who checks, the key, on which landings, the measurement, and the last change. A task visible in the rule's outline isn't repeated in "Referenced by".
- A text-only rule has "Text only" and a check choice: a key from `tagma.config.ts` with a trial measurement (the found becomes debt on a new task) or a thread that will pick a check.
- The screen updates itself when the check changes, a remeasure passes, or a rule is created, edited, switched, or deleted.
- Debt history belongs to the graph copy. A debt-record count change arriving from the graph tree, including on worktree merge, gets an import timestamp; former points keep their numbers.

**Limits.** What the check judges is changed only by editing `tagma.config.ts`. The Rules point in the rail shows no dot on new slip-throughs. Trigger choice beyond landing is only through `enforce_rule`.
