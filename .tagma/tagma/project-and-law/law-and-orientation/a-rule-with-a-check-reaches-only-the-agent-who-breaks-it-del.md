---
id: 01a18e05-2be5-70f0-9807-09e0773fc3aa
title: "A rule with a check reaches only the agent who breaks it: delivery with the finding, the finding carries the body, search hits bring no rules"
ord: 11
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-632f2c5e9bd2
  - kind: relates
    to: 01a15a16-e8b3-770b-ac40-23695402820c
---
## Why

A rule's sources do two jobs at once. They decide who receives its text under `code` delivery (`graph/orientation/touches.ts`, `touchLaw`), and they decide what its check judges: sources become the rule's places (`graph/orientation/reach.ts`, `lawReach`), and a commit runs the check only over changed paths inside them (`enforcement/judging/judge.ts`, around `touching`).

A norm whose violation can appear in any file — a door every feature must pass, a code pattern, a naming convention — has no good sources:
- narrow sources (the door's files) deliver the text only to agents who open the door, and the check judges only the door, so the agent writing the violating call elsewhere never sees the rule and is never refused;
- wide sources (the whole code) deliver the text to every agent who reads or greps any file, though only a writer can break it and the check is what actually stops the breach.

The `#rule` declaration itself prescribes the broken recipe: "one about code spread over many callers is sourced to the door they all pass, with a check on its callers offered", beside "the rule measures the code its sources name". A fresh agent asked to design such a rule from its instructions alone, with no tools, followed the recipe and then found the contradiction without resolving it.

Two more defects make every rule noisier or poorer than it needs to be:
- a file seen only in search output brings its rules whole (`touchText`, `as: 'found'`), though the agent neither opened nor wrote it;
- a finding prints the rule's name, title and strictness only (`Norm` in `enforcement/contract/wire/findings.ts`), so the conditions and exceptions in the body never reach the agent who broke the rule.

One sample, this repository: about 27 of 204 rules are sourced to the whole code, and they dominate delivery — one first read under `apps/tagma/server/src` brought 27 rules at once.

## What changes

### 1. Delivery `finding`

A third value of the law delivery role beside `prompt` and `code`: no agent receives the text in advance — not at thread start, not on a read, a write or a search. The text reaches the agent whose change the rule's check finds breaking it, inside that finding, at every door that prints findings.

- Reach does not change: sources narrow what the check judges; no sources means the whole project within the inspection's own base. A cross-cutting norm takes no sources, or sources naming exactly the code it governs, and `finding`.
- `DELIVERIES` in `graph/contract/wire/tags/law.ts` gains the value; the shipped `#rule` declaration lists it in its `delivery` enum and reaches installed projects through the catalog release. A project's own law-bearing tag offers it when its declaration lists it. The default stays: unset is `code` with sources, `prompt` without.
- Prompt law selects `prompt` alone (`graph/orientation/law.ts`) and touch law `code` alone (`touchLaw`), so neither delivers a `finding` rule without further change.
- A finding needs a check that runs. `finding` holds only on a rule enforced at watch or gate: `set_rule_delivery` to `finding` on any other rule refuses, naming both ways out (enforce it at watch or gate first, or choose `code` or `prompt`); `enforce_rule` that turns a `finding` rule's enforcement off or moves it to note refuses, naming its way out (change the delivery first). A rule switched off with `set_rule_enabled` reaches nobody because it is off; nothing more is gated.
- The warning `set_rule_delivery` gives for `code` with no sources names `finding` as the delivery that reaches the agent breaking an enforced rule.

### 2. A finding carries the rule's body

`Norm` carries the body beside the title; `findingLines` prints it once under the norm line, before that rule's places. The judge already holds each rule's block record (`enforcedStatutes`), so no read is added. Every door printing findings shows it — the gate refusal, `submit_work`'s watched findings, `check_rules`, the `git commit` hook, the after-edit notice (`fileCheck`), holder notifications, `read_enforcement` — and so does the Rules screen's `Findings` component. Stored records stay as they are: a refusal keeps what was said, and the norm is read from the rule. This holds for every delivery, not only `finding`.

### 3. Search hits bring no rules

A file seen only in search output brings no rule text; its explanations keep their one-line pointer. The rule arrives when the agent reads or writes that file, as now. The change sits in `touchText`, the one place native tools and external-harness hooks share.

### 4. The `#rule` declaration says how to choose

The sentence prescribing the door recipe is replaced by three cases, densely:
- a norm about particular code: `code`, sourced to that code;
- a norm whose violation can appear anywhere, with a check: `finding`, sourced to the code the check must judge, or to nothing for the whole project;
- a norm every thread needs whatever it works on: `prompt`.

It keeps the plain statement that sources narrow what the check judges whatever the delivery. The `rules` skill describes the same in the same change.

## Interface

- Block page, Delivery line (`BlockFacts.svelte`): `finding` reads "Only with its check's finding, to the agent whose change breaks it".
- Delivery menu (`BlockActionsMenu.svelte`): a fourth choice, Finding, with the same words. On a rule not enforced at watch or gate it stays visible and disabled, its title saying it needs a running check.
- Wherever the Rules screen names a rule's delivery, it uses the same words; its `Findings` component shows the rule's body under the norm.

## Out of scope

- Delivering a `code` rule before the first write into its code instead of on a read.
- After-edit checks for writes reported by external-harness hooks and for `bash`.
- Moving this project's existing rules: each rule's owner does that. Rule [[93f04f23]] moves to `finding` once task [[25400674]] enforces its check.

## Acceptance

Proved by the performer through the doors real callers use (`touch_path`, the native `read`, `write` and `grep` tools, `set_rule_delivery`, `enforce_rule`, `submit_work`), with the fewest tests that prove each point:
1. A rule enforced at gate with `finding` and no sources: thread start, reading, writing and grepping any file deliver none of its text; a commit adding a violation anywhere in the inspection's base is refused, and the refusal prints the rule's title and body.
2. `set_rule_delivery` to `finding` on an unenforced rule refuses with both ways out; `enforce_rule` turning a `finding` rule off refuses with its way out.
3. A file matched only by `grep` delivers no rule; reading it then delivers its `code` rules once.
4. `findingLines` prints a rule's body once above its places.
5. The shipped `#rule` declaration lists `finding` and the three cases; an installed project receives it through the catalog update and keeps its own appended section.
6. The block page and the delivery menu show `finding` in words.
7. Feature [[2c5e9bd2]], explanation [[5402820c]] and the `rules` skill describe the new behaviour.
