---
name: skill-creator
description: Create or change an agent skill — a project's or the user's skill folder, or a skill built into Tagma under native-harness — and check that it loads, triggers and teaches what it should. Load before writing or editing any SKILL.md, a skill's references, scripts or description, or a built-in skill of the product.
---

# Writing skills

## Where a skill lives

- **Project**: `.agents/skills/<name>/`, and `.claude/skills`, `.codex/skills` by default (`skills.directories.project`). **The user's own**: `~/.agents/skills`, `~/.claude/skills` (`skills.directories.global`). A project skill shadows the user's of the same name.
- **Built into Tagma**: `apps/tagma/server/src/native-harness/skills/<name>/`. The release cut copies each such folder into the installation's `skills/`, and the server serves it from there, so the `location` load_skill answers names the installation. A built-in shadows a discovered skill of its name; once `skills.disabled` names the built-in, the discovered one stands in for it.
- The folder name is the skill's id. Tagma's agents and every harness on its MCP get skills through `load_skill`.

## Form

- **`SKILL.md`**: frontmatter `name` — the folder name, which other harnesses read — and `description`, then the body. A file without a description or with an empty body is rejected with its reason.
- **`references/<name>.md`**: a section kept out of the body. Tagma lists each in the catalog line as `refs: <name> (<its first line>)`, so the first line is a heading of a few words. An agent receives the references it names in `load_skill` `references` with the body, or reads the file under `location` later.
- A reference holds only a large section that a minority of the skill's tasks need. Everything else stays in the body; length alone is no reason to split.
- **`scripts/`, `assets/`** in a project or user skill: the agent runs or reads them by path from `location`. A built-in skill carries none: an act it lacks becomes a Tagma operation, and a tool it needs only while loaded comes through `AgentSkill.tools`.

## What a skill is

A skill teaches an agent to do one kind of work the way the product needs it done: what to do, in what order, the rules that hold, and the reason behind a rule the reader would otherwise break. Nothing else goes in.
- Write it for anyone who works in the repository — a contributor, another user's agent on another machine — who knows nothing of who wrote it or when. It names no person, no one machine and no current push or order: a norm the project's owners set is written as the norm itself.
- A skill is not a record. Measurements, dated baselines, run results, findings, lists of past incidents, task and commit ids and targets stay with the task or note that produced them; the skill keeps only the rule they led to.
- A number stays only when the reader acts on it: a limit the tool enforces, a flag value, a threshold its output uses. A measured cost becomes the rule it justifies — "birth a project once per file", not its CPU.
- An example stays only when without it the reader would apply a rule wrongly, and it is written as a case of the rule, never as what once happened in this repository.

## The description

The description stands in every thread's catalog: what the skill does and when to load it, in the words a task or a person would use. Name the adjacent cases only where they would load it wrongly. It is paid on every turn, so it carries triggers, never praise.

## The text

- Dense and only about what exists: the current mechanism, with no history, removed features or statements of absence; only the conditions and distinctions the reader needs.
- Every claim about the product is read in its code — an operation in its description and implementation — before it is written.
- Teach where to look instead of restating what a tool answers: a catalog an operation serves is read there.
- Imperative; a reason where a reader would otherwise apply the instruction wrongly; no capitals for emphasis.
- English: a skill is a prompt.
- A built-in skill describing a mechanism is kept current by a rule on that mechanism's code: the change to the mechanism updates the skill in the same change.

## Checking a skill

- Load it with load_skill and read what arrived: the catalog line, the body, each reference.
- Where triggering or behaviour is in doubt, give two or three realistic tasks to child agents with the skill available and read their threads; correct what they misread. Measure only what is in doubt.
- A test covers the public contract only — that skills are discovered and load; no test pins a skill's text.
