---
id: 01a0d98f-a339-7f6b-aeb5-76a126598301
title: Tagma ships a builtin `rules` agent that measures a project, proposes which rules to check and how, and enables them only on the operator's word
ord: 45
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
The operator's word, 2026-09-25. Nothing in the enforcement engine is on by default ([[b9bdfa95]]), and nobody configures rules by hand, so every project needs one agent whose job is to set that configuration up. That agent is part of Tagma, not of any one project.

## 1. Observable outcome

- A builtin agent definition, `rules`, appears in every project's agent library beside `tagma` and `code`.
  - It sits under `apps/tagma/server/src/harness/agents/rules/`, like `code/` and `tagma/`.
  - Like them, it is not editable in place.
  - A project overrides it by declaring its own `.agents/rules.md`.
- **Asked for a scope** (the whole project, a module or a directory), it answers a proposal: which rules to measure, with what inspection and parameters, on which triggers, at what strictness, and the debt each would carry with the owner it suggests.
- **It measures before proposing:**
  - it reads the code and the graph (areas, rules and claims);
  - it runs `read_inspections`;
  - it tries each candidate with `check_rules` (an unsaved `inspection`), so every figure it quotes was measured.
- **It enables nothing without the operator's word.** Once the operator agrees, it runs `enforce_rule` exactly as agreed. The mode's permission floors apply: a loosening, and naming a program, still ask under trust.
- **It also maintains rules already set up:**
  - it reads the enforced rules, their debt, their escapes (`rule-escaped` findings) and their measured time;
  - it proposes tightening, loosening, retiring debt, new triggers or switching a rule off, each with its evidence.

## 2. Problem, with evidence

After [[b9bdfa95]] a project gets nothing until a rule's setting is written. Today that is done by hand by whichever agent knows the engine: this thread wrote [[f49f228f]] and [[0d2c66a9]] itself. A new project has no one who knows `read_inspections`, `check_rules` and `enforce_rule`.

## 3. What holds now

- Builtin agents are code under `harness/agents/<id>/`: an `agent.ts` with an `AgentDeclaration` and an `identity.ts` with its prompt. The library merges builtin, project and personal declarations.
- The engine's tools belong to the `graph` capability (`enforce_rule`, `read_inspections`) and the `shell` capability (`check_rules`).

## 4. Target model

- **Declaration.** `id: 'rules'`, with a description in product words. Capabilities: graph, files, shell (for `check_rules` and reading code), skills, resources, and peers (to hand long reading to a cheaper reader). No web, no worktrees, no terminals.
- **Identity, the prompt.** It carries the engine's model, not runlith's opinions:
  - rules are law in the graph, and a check is optional data on a rule;
  - nothing is on by default, and every trigger is a deliberate choice;
  - builtins are neutral and take their conventions as parameters, while opinions live in presets and packs;
  - debt is owned by a standing task or decision and is never an exception;
  - a failing test is not debt where the project says so (a project rule such as [[93739392]] binds it like any rule);
  - strictness per rule: note, watch or gate;
  - measure first, propose with evidence, enable only on the operator's word;
  - prefer few rules that hold over many that are ignored;
  - a small project may rightly get none.
- **The prompt carries no tool list, operation catalog or parameter schema.** It reads those from `read_inspections` at run time, so the engine can grow without the prompt going stale.
- **Proposal shape**, in its answer to the operator:
  - one line per rule: the rule (existing or to be written), the inspection with its key parameters, the triggers, the strictness, the violations found now, and the debt owners;
  - then the recommendation and its main tradeoff.

## 5. Owners and boundaries

- `harness/agents/rules/` owns the declaration and the identity. It adds nothing to the engine.
- The engine ([[805446cf]]) stays the only writer of enforcement documents, through `enforce_rule`.

## 6. Rejected alternatives

- **A project agent in runlith's `.agents/`.** It would exist in one project only.
- **A skill loaded by the `tagma` agent.** The configuration job needs its own identity and its own default of proposing before acting, and a thread can be addressed by name for it.

## 7. Acceptance criteria

- `read_agent_library` lists `rules` as builtin in any project.
- `read_agent rules` composes its prompt, and the prompt names no operation id outside what its capabilities mount.
- A live run in a fixture project with no rules, asked for "set up architecture checks for `src/`", answers a proposal whose every figure came from a `check_rules` call in its transcript, and writes no enforcement document.
- The same run, told "enable the first one", calls `enforce_rule` once, and the rule's document matches the proposal.
- A project `.agents/rules.md` overrides the builtin.

## 8. What becomes of each claim and task it touches

- The claims over the agent library that enumerate the builtin agents are revised.
- The idea [[f5648cf9]] records the setup agent as built.

## 9. Order of building

The declaration and identity, then the library test, then the live fixture run.

## Spec list

- 10 Contract: a new builtin agent id. Existing threads are unchanged.
- 12 Who may do what: it holds exactly the permissions of its capabilities under the thread's mode, and enables only after the operator's word, both by its prompt and by the permission floors.
- 17 Observability: its thread shows every measurement and proposal.
- out: stored data, long-lived things, bounded resources and failures. It is a definition and adds no state.
