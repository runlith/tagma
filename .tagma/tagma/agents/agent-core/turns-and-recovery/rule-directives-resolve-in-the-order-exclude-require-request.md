---
id: 01a11bc1-aec3-7d58-9aa1-ef82678b6045
title: Rule directives resolve in the order exclude > require > request > restrict, regardless of arrival order
ord: 2
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/agent/src/agent/policy/AgentRuntimePolicy.ts
    symbol: agentStepToolPolicy
---
Rule directives resolve in the order exclude > require > request > restrict, regardless of their arrival order.

This is the rule pipeline's published contract; changing it is the operator's decision, not part of a refactoring. Directive pairs are pinned by the `AgentRuntimePolicy.test.ts` test.

- `exclude` always removes a tool: a requirement or request for an excluded tool yields no `toolChoice`, and `restrict` does not bring it back.
- `require` beats `request`: the first `require` is taken, `request` only when no `require` exists.
- A required or requested tool joins the set narrowed by `restrict`.
- `guide` conflicts with nothing and only adds text.

Rules evaluate by `priority` (lower first), ties in the order given; a rule with a `hook` fires only on it. A non-critical failure and a slow rule leave a typed `rule-failed` / `rule-slow` note with the rule owner on the run; a critical failure refuses the evaluation.
