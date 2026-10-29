---
id: 01a185bb-3548-77a9-b26d-4ca7d477a966
title: Agent audits a page's accessibility and gets each failing element as a reference it acts on
ord: 14
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046576c9a0f3
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/contract/wire/auditOperations.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/audit.ts
---
**Value.** An agent fixing a page's accessibility gets what fails and where in one call, and acts on the failing element at once: each failing node comes back as the same reference the page snapshot shows, frames from other sites included. It replaces a Lighthouse run, which resets the origin's storage and enables the automation signals sites read.

**How.** `audit_page` runs axe-core's rules on the page and answers its violations by rule.

**Behaviour.** Violations come most severe first, each with its impact, the requirement in one line, a link to the rule, its WCAG tags, how many nodes fail it and the listed nodes, each with what fails on it as axe-core measured it (a contrast ratio and its colors, a missing name) and a short HTML excerpt. The node limit is shared across rules so each shows some. Nodes axe-core could not judge are counted for a human look, not listed. The agent may narrow the audit to one reference's subtree or to rule tags such as `wcag2aa` or `best-practice`. The rules run in the engine's isolated world of every frame, out-of-process frames included, so the page's own scripts never see axe-core; a frame that cannot be audited is named, and the rest of the page is still audited. A page in the operator's DevTools or with an open dialog refuses as for any action. Hung-renderer detection pauses for the profile while rules run.

**Limits.** Only what axe-core checks automatically: no keyboard walk, screen reader output or other Lighthouse categories. The desktop path is proven by code, not by a run.
