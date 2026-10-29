---
id: 01a14c14-a11c-7ce8-9d84-632d82cf4c27
title: A rule is switched off and back on without losing its text or its check
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-694624989efa
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-6334c46b6b5f
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/cli/blocks.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/operations/outline.ts
    symbol: OUTLINE_OPERATIONS
---
**Value.** A sound rule that must not bind agents right now is lifted for a while without deletion or rewriting.

**How.** `tagma disable <rule>`, `tagma enable <rule>`; the `set_rule_enabled` operation.

**Behaviour.**
- A switched-off rule is delivered neither at startup nor on code touch, its check does not judge, and a new `enforce_rule` against it refuses.
- The check document and the debt stay on the rule.
- The answer names how each thread's startup cost changed.

**Limits.** Switching off is for sound law that must not apply right now; an unsound rule is rewritten or replaced. Only the tag node carrying the law is switched.
