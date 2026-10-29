---
id: 01a14c14-a11c-7ce8-9d84-632e5592ee8d
title: Global graph carries law for every project on the machine; a project turns it off whole or by names
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-6331473f428a
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/orientation/law.ts
    symbol: lawReads
  - kind: symbol
    ref: apps/tagma/server/src/graph/settings.ts
    symbol: globalRules
  - kind: symbol
    ref: apps/tagma/server/src/graph/settings.ts
    symbol: rulesOff
---
**Value.** A norm shared across all the operator's repositories is written once and reaches every thread of every project; a project it does not fit turns it off for itself.

**How.** Rules in the `global` project; the `rules.global.enabled` and `rules.global.disabled` settings for user or project, Global rules section in Settings.

**Behaviour.**
- The global project always exists and is born stealth. Threads and child agents work in it, files lie there; branches and worktrees are available with git in its folder. The storage mode changes like other projects', the working folder never moves, and the project is never deleted.
- Other projects inherit prompt rules of the global graph's main copy. Changes in its branch or worktree reach them after merging into the main copy.
- These rules stand first in a thread's instructions and in a foreign CLI's orientation, marked as global.
- Rules turned off by name drop on name-suffix match; the rest keep arriving.

**Limits.** Only prompt rules inherit from the global graph. A global rule is only delivered: `enforce_rule` judges its own project graph's rules. Work in a selected global copy gets that copy's law like work in any project.
