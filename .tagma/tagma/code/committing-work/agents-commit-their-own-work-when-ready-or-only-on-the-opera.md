---
id: 01a14c13-c481-7acc-8aa6-03bbcfdb998e
title: Agents commit their own work when ready or only on the operator's word — by the agent.autoCommit setting
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/doctrine/commits.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/settings.ts
    symbol: autoCommit
---
**Value.** The operator decides whether agents' work piles up uncommitted until asked or lands in commits as it gets ready.

**How.** The `agent.autoCommit` setting, off by default, on the user or project. It changes the Commits section in native thread instructions and in CLI session orientation.

**Behaviour.**
- Off: the agent commits only at the operator's request, and its report names the changed files.
- On: the agent lands work with `submit_work` before the run ends, one call per checkout with its lines; in a shared checkout a parent finishes committing what its stopped child left, under the child's authorship. The agent names a landing refusal in the final answer together with paths it still holds.
- In both modes the commit goes through `submit_work`; bare `git commit`, amend, push, and skipping hooks are only on the operator's word.

**Limits.** This is a model instruction, not server automation: at run end nobody commits for the agent, and an agent that disobeyed the instruction leaves work uncommitted.
