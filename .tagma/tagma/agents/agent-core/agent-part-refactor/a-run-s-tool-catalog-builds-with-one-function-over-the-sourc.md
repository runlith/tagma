---
id: 01a118eb-3e7e-7085-8f2e-2ccc8451c5c9
title: "A run's tool catalog builds with one function over the source registry: only the definition's grant and verdict deny"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentScope.ts
  - kind: file
    ref: packages/agent/src/permissions/vocabulary.ts
  - kind: file
    ref: packages/agent/src/thread/agents/AgentProfile.ts
---
Goal: one function builds the tool catalog the model sees in a run. Its invariant is "definition X ⇒ the model sees and the door executes exactly tools Y". A narrow definition (a player that knows only `look` and `act`) is expressed by one grant. It gets no `fork_thread`, `ask_user`, `tool_search`, and nothing else beyond what is issued.

## Now

The catalog is assembled in seven places:
- `Agent.tools(ctx)`;
- the Tagma `agentTools` / `deferredAgentTools`;
- the `ThreadToolSources` port;
- the merge with the output scope in `runParts`;
- `keepTools`;
- the deferred insert in `agentScope`;
- admission at the restored-context boundary.

The Tagma profile path force-returns tools into any narrowed selection:
- `AgentProfile.ts:19-23` returns the fork source;
- `AgentProfile.ts:53-55` appends `ask_user`, `final_answer`, and `fork_thread` to a named list;
- `ThreadRunStarter.ts:507-510` returns `fork_thread` into the restored context's keep-list;
- the Tagma `composeAgent.ts:96-102` merges the user-question tools into every agent.

Two more inserts are conditional and correct on their own, but decide past the one function:
- `AgentScope.ts:37-39` inserts `tool_search` while deferred tools remain;
- `collaborationToolSources.ts:24-26` serves fork tools when fork is admitted.

Three tests pin the forced addition: `AgentProfile.test.ts`, `admittedToolSources.test.ts`, `collaborationToolSources.test.ts`.

## What gets built

- The effective-admission contract and its resolver live below the loop and the door, on their own `agent/catalog` floor. They take the definition, profile, contribution, and mode-verdict shapes as their own. The thread assembly translates its data into them and does not become a dependency of `agent/`. The owner is one function:
  `resolveCatalog(definition, profile, contributions, verdicts) → { catalog, withheld: { name, reason }[] }`.
  Its result is the run's effective admission. Both the model list and the door work from it.
  - The native loop, the hosted road, the restored-context boundary, and the scope update after deferred-discovery call it.
  - No other place adds or removes a tool.
- `ToolGrant = { sources: { source, tools? }[], deny?: ToolName[] }` in the definition. Only what is listed is issued.
- An agent holds exactly the tools its definition issues, and nothing outside the definition adds any; there is no forced-addition mechanism. Built-in agents (`tagma`, `code`, `rules`, `declared`) enumerate in their definitions what users see today (`ask_user`, `final_answer`, `fork_thread`, output-scope tools), so nothing changes for the user. A narrow definition gets only what is listed.
- `tool_search`, fork-, question-, and output-scope tools are contributions of their owners. They pass through `resolveCatalog` with no special branch, under their own conditions: `tool_search` only while deferred tools remain.
- `PermissionVerdict` gains `deny`. That is separate from grant: grant decides what the agent is issued, while `deny` is a policy or mode answer to a call.
  - An unconditional `deny` on a tool removes it from the catalog with a reason in `withheld`.
  - A conditional `deny` (by arguments) is refused by the door with a typed refusal visible to the model.
  - The narrow catalog does not depend on `deny` and is built by one grant.
- Precedence inside the function is declared and single:
  1. the grant's explicit `deny` and a mode or policy unconditional `deny`;
  2. grant;
  3. step directives (`exclude`, `restrict`, `require`, `request`) — only inside what is already admitted, in their published order ([[bb429da3]]); they cannot bring back what was not admitted.
- Grant, deferred-tool exposure to the model, and an already-accepted call's receipt are different states of one admission. Repeating a finished call id returns the recorded outcome and does not pass admission again.
- **The tool-source registry** is built here, before `featureLayers` removal ([[7337d0bb]]): `{ id, owner, tools(ctx with caller), prompt?, grantable }`, `register → disposal`, opt-in on the thread. Collaboration, fork, `ask_user`, output scope, `tool_search`, skills, and MCP servers register with it. A registry request carries the run's single `ThreadContext`: contributions resolve inside the agent's `toolCatalog` against it, once per run, with no second resolution before the catalog; there is no separate `ThreadToolSources` port. Two contributors' id intersection is refused at registration naming both — today that is `ThreadCallBroke` at runtime (`admittedToolSources.ts:18-22`).

## Acceptance criteria

- Run test: a definition with grant `{look, act}` from one source gives the model exactly `{look, act}` at each point:
  - on the native road;
  - on the hosted road, including a hosted-call repeat;
  - after context restore with a keep-list;
  - after a scope update.

  `fork_thread`, `ask_user`, `final_answer`, and `tool_search` stand in `withheld` with reason `not-granted`.
- Same test: calling an unissued name — including a name the catalog held before restore — is refused by the door with a typed refusal and never executes.
- The built-in agents' tool-name sets match before and after. That is a name-snapshot test, not a prompt test.
- The module-card dependency graph: `agent/catalog` does not import `thread/`; the native loop, the hosted road, and the context boundary call `resolveCatalog`, and there is no other place in the package or `native-harness` that adds or removes a tool.
- Precedence tests: an explicit `deny` beats grant; a step directive does not bring back an unadmitted tool.
- `rg` over the package and `native-harness`: no `forced` concept and no tool addition outside the definition; `admittedRuntimeSources`, appending to `profileToolNames`, returning `fork_thread` into the keep-list, and merging user questions in `composeAgent` are deleted.
- `evaluate` answers `deny`. Test: an unconditional `deny` removes the tool and names it in `withheld`, while a conditional `deny` refuses the call.
