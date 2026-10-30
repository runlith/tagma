---
id: 01a18e05-2be5-70f0-9807-09e0773fc3aa
title: A rule with a check can be delivered only in its check's results, which carry the rule's body; search hits bring no rules
ord: 11
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-632f2c5e9bd2
  - kind: relates
    to: 01a15a16-e8b3-770b-ac40-23695402820c
---
## Why

A rule's sources do two jobs at once. They decide who receives its text under `code` delivery (`touchLaw` in `graph/orientation/touches.ts`), and they decide where its check looks: sources become the rule's places (`lawReach` in `graph/orientation/reach.ts`), narrowed to the inspection's base, and a commit runs the check when a changed path lies inside them or is one the inspection declares relevant; a changed inspection description measures the whole reach (`touching` and `judgement` in `enforcement/judging/judge.ts`).

A norm whose breach can appear in any file — a door every feature must pass, a code pattern, a naming convention — has no good sources:
- narrow sources (the door's files) deliver the text only to agents who open the door, and the check looks only at the door, so the agent writing the breaching call elsewhere neither sees the rule nor is refused;
- wide sources (whole trees) deliver the text to every agent who reads or greps any file there, though only a writer can break the rule, and its check is what actually stops the breach.

The `#rule` declaration prescribes the broken recipe: "one about code spread over many callers is sourced to the door they all pass, with a check on its callers offered", beside "the rule measures the code its sources name". A fresh agent asked to design such a rule from its instructions alone, with no tools, followed the recipe and then found the contradiction without resolving it.

Two more defects weigh on every rule:
- a file seen only in search output brings its rules whole: `Touches.touch` collects rules whatever the file was shown as, and `touch_path` answers them, so native tools, harness hooks and direct callers all receive them;
- a check's result names the rule, its title and strictness only (`Norm` in `enforcement/contract/wire/findings.ts`), so the conditions and exceptions in the body never reach whoever must fix the breach.

One sample, this repository, read by a reviewer: a first read under `apps/tagma/server/src` brought 35 rules, 34 of them sourced to whole trees.

This spec fixes delivery for rules that have a check. A rule without a check keeps today's choice between `code` and `prompt`; delivering it on the first write instead of on a read is a separate spec.

## What changes

### 1. Delivery `finding`

A third delivery beside `prompt` and `code`: the text is delivered to no agent in advance — not at thread start, not on a read, a write or a search — and stands in the results of the rule's check, wherever those results are shown. Delivery stays independent of enforcement: `finding` decides only what is not delivered in advance; strictness and triggers keep deciding when the check runs.

- Reach does not change: sources narrow where the check looks; no sources means the whole project within the inspection's base. Switching delivery never changes reach, debt or measurement.
- The server knows `prompt`, `code` and `finding` (`DELIVERIES` in `graph/contract/wire/tags/law.ts`). A law-bearing tag may declare any non-empty subset of them: the vocabulary check (`law.check` in `enforcement/contract/service/lawBehaviours.ts`) stops demanding the exact set, so a project's own law tag, a fork of `#rule` and an installed `#rule` declaring `[prompt, code]` stay readable. The shipped `#rule` declaration lists all three and reaches installed projects through the catalog release.
- `set_rule_delivery` refuses a value the rule's own tag does not declare, naming the values it does (today `setDelivery` in `graph/blocks/law.ts` checks none). The `delivery-undeclared` hint names the known values instead of a hardcoded pair.
- The default stays: unset is `code` with sources, `prompt` without.
- Prompt law selects `prompt` alone (`graph/orientation/law.ts`) and touch law `code` alone (`touchLaw`), so neither delivers a `finding` rule.
- A `finding` rule whose check runs at no trigger — not enforced, at note, or enforced with no triggers — reaches nobody automatically. That state is derived, not gated: the answers of `set_rule_delivery` and `enforce_rule` warn when they leave a rule in it, and the rule's delivery label says so wherever it is shown. The warning `set_rule_delivery` gives for `code` with no sources names `finding`.
- Every projection of a delivery shows the new value: the reach label (`reachLabel` in `graph/orientation/reach.ts`, printed as `delivered:` by `read_block`), the `set_rule_delivery` meaning text, the block page and the delivery menu.
- A server older than this change reads `finding` as no delivery and falls back to the default, so a `finding` rule without sources reaches every thread of that server as `prompt`. A team on mixed versions meets this until it updates.

### 2. Check results carry the rule's body

A check's result is the contract an agent fixes the breach from, so it carries the whole norm: name, title, strictness and body, once per rule in each answer, never repeated on every crossing. This holds for every delivery: a `code` rule's text may never have reached the writer — writes inside scripts, CLIs that report no files, a compacted context.

The body travels from the rule record the judge already holds (`enforcedStatutes`) through every projection of a result:
- the gate refusal and the answer of `submit_work` — refused, watched, rechecked and carried findings;
- `check_rules` (its target and norm in `enforcement/judging/check.ts`);
- the `git commit` hook, which receives results over the wire;
- the after-edit notice (`fileCheck`) and holder notifications;
- `read_enforcement` — engine rows, the rule's norm, continuation pages and its text voice (`engineVoice`);
- the Rules screen, where the norm stands once per page or group, not on every table.

Nothing stored gains the body: the landing journal stays as it is, and replay reads the current norm from the rule as it already does for the title (`enforcement/remeasure/rule.ts`). A result with no rule behind it carries an empty body.

### 3. Search hits bring no rules

`Touches.touch` puts no rule, and no tag prompt those rules alone brought, into the brief of a file shown only in search output; explanations keep their one-line pointer. The rule arrives when the agent reads or writes the file, as now. Fixing it at the producer covers `touch_path`, native tools and harness hooks at once.

### 4. The declaration and the `rules` skill say how to choose

The sentence prescribing the door recipe is replaced, densely:
- a norm about particular code: `code`, sourced to that code;
- a norm whose every breach its check catches, wherever it appears: `finding`, sourced to the code the check must look at, or to nothing for the whole project;
- a norm an agent must know before designing, or one its check catches only in part: `code` on the code it governs, or `prompt` if every thread needs it — a check does not make it `finding`;
- a norm with no check that can be broken anywhere: offer a check; until one exists, `code` on the code it governs.

It keeps the plain statement that sources narrow where the check looks, whatever the delivery, and that a `finding` rule's earliest result is its earliest run: at landing by default. For a check that judges one file alone (`fileLocal` in the inspection contract), an `edit`/`write` after trigger brings the result seconds after the write — for Tagma's native tools only; writes by external harnesses and `bash` reach it at landing.

## Interface

- Block page, Delivery line (`BlockFacts.svelte`): `finding` reads "With its check's results — no agent gets it in advance"; a `finding` rule that no automatic run judges reads "With its check’s results — its check runs on nothing, so no agent gets it".
- Delivery menu (`BlockActionsMenu.svelte`): its choices are the values the rule's tag declares, read through `TagCatalog`; Finding stands among them when declared.
- The Rules screen names a rule's delivery in the same words. A rule's page there is its block page, which already shows the body above its findings.

## Not covered

- Delivering a rule without a check on the first write into its code instead of on a read.
- After-edit checks for writes reported by external-harness hooks and for `bash`.
- Moving this project's existing rules: each rule's owner does that. Rule [[93f04f23]] moves to `finding` once task [[25400674]] enforces its check.

## Acceptance

Proved by the performer through the doors real callers use, with the fewest tests that prove each contract:
1. A rule with `finding` and no sources, enforced at gate with a landing trigger: thread start, `read`, `write`, `grep` and `touch_path` deliver none of its text; a commit adding a breach anywhere in the inspection's base is refused, and the refusal carries the rule's title and body.
2. A project law tag declaring `[prompt, code]` stays readable and its rules are judged at landing; `set_rule_delivery` to `finding` on its rule refuses naming the declared values, and succeeds once the tag declares `finding`.
3. A `finding` rule left with no automatic run: the `set_rule_delivery` or `enforce_rule` answer that leaves it so warns, and `read_block` shows the state.
4. Switching a rule's delivery leaves its reach, debt and measurement unchanged.
5. The `touch_path` document for a file shown only as found carries no rules; reading that file then delivers its `code` rules once.
6. `check_rules` and `read_enforcement`, including a continuation page, carry each rule's body once; the `git commit` hook prints it.
7. A landing journaled before this change replays.
8. The delivery menu offers what the tag declares and sets `finding` through `set_rule_delivery`.
9. Feature [[2c5e9bd2]], explanation [[5402820c]], the `#rule` declaration and the `rules` skill describe the new behaviour, checked by reading.
