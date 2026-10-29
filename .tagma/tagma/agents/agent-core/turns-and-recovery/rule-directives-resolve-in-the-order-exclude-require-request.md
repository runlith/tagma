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

At `beforeTool`, `deny` and `rewrite` judge the one call instead of the step's tool set: `deny` beats every `rewrite`, and among rewrites the first wins, since each replaces the whole input and two cannot merge. A denied call answers the refusal a `deny` permission verdict gives, unprepared and unasked. `beforeTool` is evaluated once per call, when the step orders its calls, and admission reuses that verdict: a rewrite changes what the call touches, so its claims must come from the rewritten input before any other call queues against them, and a denied call claims nothing. A rewritten input is decoded by the tool's own arguments, so claims, subjects, permission and review judge it; an input the tool does not take fails the call naming the rule. Elsewhere both are ignored.

A rule answers one directive, several, or none. Rules evaluate by `priority` (lower first), ties in the order given; a rule with a `hook` fires only on it. A non-critical failure and a slow rule leave a typed `rule-failed` / `rule-slow` note with the rule owner on the run; a critical failure refuses the evaluation.
