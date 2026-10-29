---
id: 01a0cfab-7283-74e9-93f4-0470270d1e2b
title: Join rules and the default to bash on both roads, send a time only when named, and add timeout none
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d021-26db-71cb-8076-066b343adade",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0cf38-b201-7723-b919-48c38cb4e34f
  - kind: waits-on
    to: 01a0cfab-71cf-7f69-992b-9a35252bf193
  - kind: waits-on
    to: 01a0cfab-7228-79f3-a863-a79450212475
---
This is stage 1, part 3 of [[8cb4e34f]].
- **Scope:**
  - the rule resolver is joined at admission, with the rules copy on the command record and the answer naming the rule;
  - the local road resolves through a server port on every call;
  - `bash` sends a time only when the caller named one;
  - `timeout: "none"` is accepted with `background: true` only;
  - the tool description states the default and `none`, and that `background: true` replaces `&`;
  - the command read shows the origin of the limit.
- **Before starting:** part 1 and the rules task must both have landed.
- **Proof:** acceptance criteria 1, 2, 5 and 6a; typecheck clean; the tool and harness suites green.

**What [[252bf193]] left for this change.** Rules landed built and tested but offered to no agent, so no user meets a rule that bounds nothing. In the change that joins the resolver, add the offers back:
- `apps/tagma/server/src/harness/capabilities/graph.ts`: `operations: () => [...GRAPH_TOOLS, ...COMMAND_RULE_OPERATION_IDS]`. The floor `commandRulePermissionFloor` already rides `permissionFloor`.
- `apps/tagma/server/src/harness/capabilities/shell.ts`: `turnNote: (ctx) => [commandRulesSection(ctx.machine, ctx.projectId, ctx.thread.id)]`, from `harness/commandRulesSection.ts`.
- `apps/tagma/server/src/operations/mcpTools.ts`: drop the `COMMAND_RULE_OPERATION_IDS` exclusion from `SERVED`.
- `apps/tagma/server/src/harness/agents/composeAgent.test.ts`: drop `...COMMAND_RULE_OPERATION_IDS` from `UNMOUNTED`.
- Then re-read the claims under [[c243dd9f]] that say "until 270d1e2b" and replace them.

The resolver is `resolveCommandTime({ rules, thread, tool, requested, defaultMs })` in `apps/tagma/server/src/protocol/commandRules.ts`:
- `rules` is `standingRules(machine, projectId, thread)` from `terminals/commandRules.ts`, mapped to `.rule` in the order it answers;
- `thread` is `null` for an act of no thread;
- `requested` is a number, `'none'` or `undefined`;
- `defaultMs` is read from the setting `commandDefaultMs` (`command.defaultMs`).

It answers `{ limitMs, origin, rule }`: `limitMs` is `null` for an unbounded `none`, and `rule` is the deciding whole-call rule, which is the ceiling and the copy the command keeps. `CommandTimeOrigin` there duplicates the origin [[50212475]] puts on the wire's `CommandDeadline`; keep one.