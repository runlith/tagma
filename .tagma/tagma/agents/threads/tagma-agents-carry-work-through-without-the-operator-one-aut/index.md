---
id: 01a16495-f5ab-78e9-8089-7d7cd5e18238
title: "Tagma agents carry work through without the operator: one authority rule in the prompt, \"the one who gave the work\" instead of \"operator\", landing by line dependency"
ord: 69
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a16487-9741-727f-8ed9-9973d2548c8d
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/doctrine/theSharedCheckout.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/tree.ts
  - kind: file
    ref: apps/tagma/server/src/landing/doctrine/commits.ts
  - kind: file
    ref: apps/tagma/server/src/threads/doctrine/deciding.ts
---
## Why

Tagma users differ: one talks to a single agent and reads each of its turns, another runs a hundred agents, watches the work from above, and never reads threads; often there is no operator at all — he sleeps or is busy elsewhere and expects to return to finished work. The prompt is one for all and must work at both edges. Tagma prompts are written as if a human sits in conversation with each agent and decides for it, so agents at an unclear point choose "ask" or "stop with a report". This concerns all users, not one runlith.

The 2026-10-22 case this spec is written for. Two agents held uncommitted lines in the same files. `cursor-compaction` received `lines-held` over `child-retune` lines, stopped, dropped the task, and ended the run; two minutes later `child-retune` received `lines-held` over `cursor-compaction` lines and stopped with "landing them whole needs the operator's word"; the lead (this thread) added "wait". There was nobody to wait for. Finished, checked work never landed, and the thread-events owner waited for its files. Every step followed the instructions; reflection — [[d2548c8d]].

The texts that assembled it (translated):

1. The `submit_work` description (`landing/contract/wire/operations.ts`): "lines of another live holder do not enter the commit… a section where this session's lines stand beside another holder's lines refuses `lines-held`" — a refusal by neighbourhood, not by dependency.
2. The "Commits" section (`landing/doctrine/commits.ts`): "`submit_work` takes this session's lines and leaves the rest out; to commit everything use `paths: ["."]` with `whole: [true]`" — `whole` read as "only on request".
3. The `taking` parameter: "…a session it did not launch, a still-working session, or the operator are taken by the operator's word" — the word requirement leaked from `taking` onto `whole`.
4. The "Working in a Shared Checkout" section (`change-record/doctrine/theSharedCheckout.ts`): "NEVER… rewrite, drop, or push aside another writer's changes… A check that failed outside your change is evidence, not permission to fix a neighbour's unfinished work" — landing others' lines feels like a violation.
5. "Commits": "if landing cannot go through, the final answer names the refusal and the paths you hold" — stopping becomes a lawful end.
6. The refusal text (`change-record/prepared/tree.ts`): "land when those holders land their lines" — waiting for the neighbour stands in one row with the way out, even when the neighbour idles or waits for you.
7. "Commits": "never write to another agent about a commit — to ask, wait, hand over lines, or report" — two stuck agents cannot agree.
8. The "Deciding" section (`threads/doctrine/deciding.ts`) and general directions: "intent unclear — describe the act and ask", "ask when any assumption is unsafe" — with no measure of "unsafe", the agent asks more often than needed.

The cause runs deeper than single phrases. The prompt is assembled from 39 doctrine sections (~62 KB), each written by its own module, and the question "who decides what" has no owner: every module and every operation description decides on its own where to be cautious — operation descriptions hold over a dozen "only by the operator's word". The word "operator" means the human and "the one who leads you" at once: a performer launched by a lead looks for the human word where the lead decides. In runlith this is patched by rule [[60ed5208]] (a lead's relay is the operator's word) and [[e53671d7]], but the product does not know it.

**Balance.** Autonomy by default; bureaucracy with no subject is harm. Protection stays where harm is real and no human can undo it.

## What the agent gets

1. **One authority rule.** The one who gave the work decides: the operator for the root thread, the lead for the performer. The human word is needed only in four cases:
   - a product decision — what to build, what matters more, what counts as done;
   - irreversible destruction of what is not yours: removing files, branches, threads, or blocks you did not create; reset, force-push, rollback of others' commits or lines;
   - an act outside the machine: push, publication, letters and messages to people, spending above what is configured;
   - its own: its settings, notes, its lines, its server and machine.

   The agent decides everything else itself; insurance is history (git, graph journal), not a question. A question goes to the one who gave the work; to the human — only through the root ([[e46b150a]]).
2. **Stop only with no way out.** The agent follows a refusal that names a way out through that way out; "could not — reported" applies when there is no way out. Waiting for a neighbour is no way out if the neighbour is not working.
3. **Landing by dependency.** A commit takes exactly its session's lines, even tight against others'. Others' lines without which its own do not build (its own stand in a neighbour's new file, or edit its line) are taken by landing itself, naming their author, by nobody's word. On mutual refusal the later arrival lands, together with the neighbour's lines. Commit checks over the assembled tree decide: on failure the refusal names the check and the place, not the holder. One thing is forbidden: removing, rolling back, or rewriting others' lines. `whole` is set onto a path, not onto the whole landing. Landing derives dependency from line origin inside the selected paths (a neighbour's new file, its insert or replacement); it derives no dependency between files through imports — the refusal names the way out (a path in `paths` with `whole`, or the holder's `taking`), and `taking` of an idle agent session's lines needs no operator word.
4. **How much to confirm is a user setting, not prompt text.** One who works with a single agent and wants to see every act chooses it with the thread mode (review, trust, bypass): the mode decides which act becomes a question. The prompt adds no second hidden handle — the authority rule is one for all, and question frequency is set by the mode.
5. **What stays as is:** an operator message that is only a question is answered without changes; the unasked-for is not removed; the project's law (rules, their strictness, commit steps) changes by the operator's word.

## Device

- **Authority owner: one section.** The `deciding` section of the `threads` module becomes the authority rule of item 1 and is placed into every assembly where it now stands (`prompt`, `base`, `law` — the last reaches other harnesses). Other sections and operation descriptions do not write their own caution but refer to it with "operator's word needed" only where their case is one of the four.
- **Pass over every "on the operator's word".** Each place in doctrines, operation descriptions, refusal texts, and skills is checked against the four cases. Fits — stays; does not fit — the one who gave the work, or the agent, decides. Currently known: machine keys in `write_setting`, operator notes, `withoutFormat`, `plain` in `spawn_agent`, the delegation switch, `taking`, `archive_thread`, renaming another's thread, another's hold in the graph, custody of another's run in the terminal, law loosening in the `rules` skill, `agent.offered`. The list grows with search during the work.
- **"Operator" means only the human.** Where the text means the one who leads the agent, it says "the one who gave you the work". This covers doctrines, the collaboration voice (`packages/agent/src/collaboration/CollaborationVoice.ts`), and operation descriptions. After that the runlith rules [[60ed5208]] and [[e53671d7]] are either dropped or stay only with what the product does not cover.
- **Caps only for real dangers.** MUST and NEVER stay at the four cases, at `git stash`/reset in the shared checkout, and at the server restart; the rest is in plain words.
- **Composition by role — deferred by measurement.** The Tagma agent prompt in runlith is about 93k characters: doctrine sections ~33k (after compression −2.4k), project rules ~19k, catalog tag declarations ~16k, immediately loaded tool schemas ~25k. Sections a performer does not need (plugins, MCP servers, agent definitions, operator emotions) are about 2.5k, ~3%; cutting them needs the thread parent at prompt build (`ThreadView` does not carry it) plus edits in files other sessions are changing now. Larger are the tool schemas and catalog tag declarations: the next pass over volume is there. Cut mechanisms already exist: the `prompt`, `base`, and `law` assemblies and skill files (`threads/doctrine/assemblies.ts`), sections bound to a capability (`CapabilityDeclaration.sections`). The work is to measure what a performer launched by the lead for one task receives, and to remove from its prompt the sections only the lead or the human conversation needs. Figure: performer prompt size before and after.
- **Landing** — logic in `change-record/prepared/tree.ts` and `landing`: a slice by line authorship instead of regions, automatic carry of dependent others' lines with authors, mutual refusal, `whole` onto a path, refusal texts without "wait for the holder".
- **Volume (operator decision).** The prompt is each agent's context: an edit does not make it larger and, where possible without losing meaning, makes it smaller. The authority rule replaces the scattered reservations rather than adding to them: the `deciding` section grows by absorbing them, while the other touched sections and the total doctrine volume shrink.
- **Order.** Landing first (item 3): it closes today's stop class. Then the authority rule, the pass over the "operator's word", and the term. Then caps and composition by role.

## Performer checks

- **Landing:** a system test on the real server — two sessions with each other's lines in one file; both land in turn with each line's authorship kept; a line depending on a neighbour's new file lands with it; an assembled tree that failed the commit check refuses with that check.
- **Agent behaviour:** scenarios on the cheap model (Muse Spark contributor — the operator allowed unlimited spending), before and after the edit, several runs per scenario:
  1. two performers with each other's lines land their work;
  2. a performer before an unclear but reversible choice;
  3. a performer receiving a refusal that names a way out;
  4. a performer that must remove another's branch or publish — must stop and ask;
  5. an operator message that is only a question — no changes;
  6. the operator one-on-one with a single agent in review mode — the agent asks no questions beyond what the mode sets, and is not silent about what it did.

  Measure: how many times the agent stopped or asked the human where there was a way; whether the result landed; no harmful act in scenarios 4–5.
- Doctrine tests (`threads/doctrine/sectionText.itest.ts`, `composition/testing/threads/doctrine.test.ts`) are updated to the new texts.
- Performer prompt size and total doctrine volume before and after: after is no larger.

## Open questions

1. What seniority order instruction kinds have — doctrine, project law, operator notes, guidance, tag prompts, skills — as the code implements it; the prompt names it in one phrase, not six words for "instructions".
2. "Spending above what is configured": which budgets are already configured (subscriptions, keys, limits) and which count as an outside act.
3. `withoutFormat` and law loosening in the `rules` skill are project law and stay the operator's word; confirm on the pass.
