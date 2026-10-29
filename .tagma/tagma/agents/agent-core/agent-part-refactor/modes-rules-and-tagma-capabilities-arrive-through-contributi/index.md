---
id: 01a118eb-3e7e-7085-8f2e-2cd3bb429da3
title: Modes, rules, and Tagma capabilities arrive through contribution registration; one owner builds the effective agent definition
ord: 9
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentRuntimePolicy.ts
  - kind: file
    ref: packages/agent/src/agent/contracts.ts
  - kind: file
    ref: packages/agent/src/permissions/evaluate.ts
---
Goal: everything that adds a mode, a capability, or (later) a plugin arrives through contribution registration with the subject it extends. No closed core or Tagma-assembly list is edited for a new variant. A new mode is one file; a Tagma module's capability is declared in that module.

## Now

- **Modes.** `AGENT_APPROVAL_MODES = ['trust','review','bypass']` (`contracts.ts:48`). Their semantics are spread across `permissionOutcome` (`evaluate.ts`), `consentRule` (`vocabulary.ts:30-33`), `AgentApproval.ts` (headless ⇒ trust), `ThreadModes.move`, `HostingQuestions.ts:206`, `ThreadHosting.bypassed`, and three wire schemas. A new mode takes a coordinated edit of seven or more files.
- **Rules.**
  - A flat list per agent with an effective order of `exclude > require/request > restrict`, where the first `require` runs before the first `request` (`AgentRuntimePolicy.ts:227-247`). The order is not published as a contract.
  - A non-critical rule failure is `console.warn` and continue (`:158-160`).
  - `diagnostics()` exists on the class (`:198-200`) but is never shown to the operator.
  - Tagma fills the rules from a hardcoded list (`composeAgent.ts:161-197`).
- **Tagma capabilities** are a central table (`capabilities/table.ts:19-35`) plus a central id list (`platform/contract/wire/capability.ts`). That contradicts [[edea5454]].
- **The agent definition** is assembled in four places: `Agent.ts`, `AgentProfile`, `ThreadAgent`, and the Tagma `composeAgent`.
- **`ThreadRunClosing`** is a second guidance channel of the same shape as rules.

## What gets built

Every registry belongs to the subject it extends. Shared registry contract:
- `register(id, descriptor) → disposal`;
- deterministic order;
- opt-in on the thread;
- diagnostics visible in activity;
- collision refusal naming both contributors;
- ids namespaced by contributor.

Registries:
- **Modes** (`modes/`):
  - descriptor `{ id, verdict(call, floor) → allow | ask | deny, onEnter(thread, waiting), headless }`;
  - `trust`, `review`, and `bypass` are three registrations with today's semantics;
  - wire schemas take the mode set from the registry, not from a literal;
  - the lease's mode-law cache lives here;
  - a thread holds one active value from one registry. A mode is a full descriptor: verdict mapping, `onEnter`, headless. A future plan-mode is the same kind of registration, not a second independent dimension;
  - the wire carries the thread's registered modes (`id`, label, description) and the active mode. The owner's operation switches it, and the mode is stored on the thread on the server. There is no mode logic on the client.
- **Rules** (`agent/policy`):
  - descriptor `{ id, owner, hook, priority, critical }`;
  - the current conflict-resolution order is published as a contract and stays; changing it is the operator's decision, not part of the refactor;
  - a non-critical failure is a typed diagnostic in activity;
  - `ThreadRunClosing` merges into the same guidance pipeline;
  - Tagma's rule list becomes owner registrations.
- **Tool-source registry** — the [[8451c5c9]] registry builds it; here it follows the same shared contract.
- **Effective definition** — one owner in `thread/agents`. It alone derives the effective definition from declaration, profile, and contributions (capabilities, mode, grant, compaction strategy) for the accepted context generation. Unchanged output is not recomputed. A change of generation, mode, or contribution set passes through the owner and publishes one new consistent admission; already-started calls and saved receipts keep their stated removal semantics. Neither the loop nor Tagma reassembles this fact itself. Today `Agent.ts`, `AgentProfile`, `ThreadAgent`, and the Tagma `composeAgent` (`composeAgent.ts:47-65,91-110`) assemble it. Every real declaration (`tagma`, `code`, `rules`, `declared`) passes through it.
- **Tagma capabilities** ([[ab05dfec]]): each module declares its own capability, and the assembly collects them — the same way `nativeOffers` already collects operations. `table.ts` and the central id list go away.
- **Event kinds and data-parts** — in [[c3436715]].
- **Compaction strategies** — in [[b0203ef2]].

Withdrawing a contribution has semantics for what already stands:
- new admissions are forbidden, and a new call is refused with the typed refusal `contributor-absent`;
- an already-started execution runs to its own outcome;
- a call waiting for confirmation is not executing yet and ends in refusal;
- repeating a finished call id returns the recorded outcome and does not execute the withdrawn tool;
- after re-registration under the same id, new calls go to the new contribution, and old receipts do not change;
- a parked question of the withdrawn contributor closes with a typed outcome;
- stored records of a kind whose contributor is missing at restart read as a typed decoding error with diagnostics, not silently lost;
- a resource whose kind is withdrawn leaves a release obligation in the ledger with a typed refusal and is not declared released (`resources/threadResourceLedger.ts:52-60`).

## Acceptance criteria

- Test: a fourth mode is added by one registration in one test file, and its `deny` works on both roads. `evaluate.test.ts` for the three built-in modes passes unchanged.
- Pair tests for rules: each directive pair resolves in the published order, which matches today's.
- `rg`: no mode-list literal outside the registry. `capabilities/table.ts` and the central id list do not exist, and a new module's capability is visible with no edit to shared files.
- `rg` over the package's production code: no `console.*` in `agent/policy`.
- Withdrawal tests: a call after source withdrawal is refused `contributor-absent`; a call that waited for confirmation is refused; repeating a finished call id returns the recorded outcome; a record of a withdrawn kind at restart gives a typed error.
- Effective-definition test: for every built-in declaration the tool set, rules, mode, and strategy equal today's, built by one owner; `rg` finds no second definition assembly in `native-harness`.

## As built (629ac667)

- **Modes** (`packages/agent/src/modes/`). Descriptor: `{ id, label, description, icon, elevated?, confirmsWaiting?, verdict(call, floor) }`. `onEnter` took the declarative `confirmsWaiting` shape: entering such a mode answers waiting tool confirmations, and a question placed under it is not asked. `elevated` grants `bypassFrom`. Headless is a shared door rule (`unattended`: ask becomes refusal) for all modes; the dead `resolveAgentApprovalMode` is deleted. The registry is a `ModeRegistry` over the shared `Registry`; `ApprovalModes` is a `Context.Reference` with a built-in default registry, the core takes its own through ports, the Tagma core takes the server registry and hands it to both harness and `consentFor`. An unregistered mode answers `deny` with the `contributor-absent` rule. The thread wire carries `modes` (id, label, description, icon, elevated); the client does not enumerate modes. Mode choice at thread birth in settings is built from `BUILTIN_MODES`: a later-registered mode is not visible there. Mode opt-in on the thread and contributor id namespaces are not built — a collision refuses with both names.
- **Rules** (`packages/agent/src/agent/policy/`). Descriptor `{ id, owner, hook?, priority, critical }`; order is `priority`, then submission order; a rule with a `hook` is called only on it. A non-critical failure and a slow rule are `rule-failed` / `rule-slow` notes on the run. The directive order is the [[678b6045]] contract. `ThreadRunClosing` is not merged into the rule pipeline — open.
- **Tagma capabilities**: a module declares a `CapabilityDeclaration` (id, description, sections, permissionFloor, runtimeSources) in its manifest `capabilities`; composition collects them into the `DeclaredCapabilities` port; the native harness adds its behaviors (files, shell, web, mcp, skills, graph) and registers them in `AgentDefinitions`. `capabilities/table.ts` and `CAPABILITY_IDS` are deleted; the `declared` agent holds `capabilities: 'every'`.
- **Effective definition** — `AgentDefinitions` in `thread/agents`: held (with overlay), declared, permissionFloor, grant and capability rules, memoized on registry revision. A rule assembled in `Agent` takes the current contribution by id on each call. Mode and compaction strategy are not part of this definition: mode is decided by `ModeLaw` on the thread, strategies by [[b0203ef2]].
- **Contribution withdrawal** is built for tool sources: a tool carries its `contributor`; a new call and a call that waited for confirmation are refused `contributor-absent` after withdrawal, a started call runs to its outcome, repeating a finished call id returns the recorded outcome; a source re-registered under the same id counts as a different contribution. Not built: closing a withdrawn contributor's parked question, the typed error for a withdrawn kind's record ([[c3436715]]), the withdrawn kind's resource release obligation.
