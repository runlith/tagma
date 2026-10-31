---
id: 01a18cb0-a4af-755c-aefc-f287afc032e7
title: "Sub-agent model settings: Tagma's ratings for Claude and OpenAI, favor as its own field, and a Team section with a rated list and a card per model"
ord: 13
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9277306eedae
  - kind: relates
    to: 01a150bf-6fc7-74e5-b8df-48414dc6d09e
  - kind: relates
    to: 01a150e5-fbff-700e-98b9-7039ac67b9de
  - kind: relates
    to: 01a15101-ab43-7efc-a255-40e446e7ebcd
sources:
  - kind: file
    ref: packages/agent/src/collaboration/team.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/team/TeamSettings.svelte
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/settings.ts
  - kind: file
    ref: packages/llm/src/models/description.ts
---
## Why

The sub-agent list (`agent.models`) is the only thing an agent reads to choose a child's model, and the operator keeps it by hand. Three things make it hard to keep and easy to misread:

- **Tagma's own ratings cover little.** Rows ship only for a few Claude and OpenAI rungs (`ANTHROPIC_TEAM` in `packages/adapter-anthropic/src/models/anthropic.ts`, `OPENAI_TEAM` in `packages/adapter-openai/src/models/openai.ts`); Codex CLI (`codexDescription`) ships none, and Terra, Opus Medium, Haiku Max and Sol Max have no row anywhere.
- **Favor reaches the agent folded into spend.** `rowWords` in `packages/agent/src/collaboration/team.ts` prints `spend − favor`, so the agent cannot tell a cost from the operator's wish, and a row with spend 1 and favor +1 arrives as spend 0, outside the scale.
- **Review is a fixed queue.** `agent.review` holds an ordered pool, and `reviewWords` tells the agent to take "the first available in this order", whatever the work; the reviewer is never chosen for the task the way a child's model is.
- **The Settings matrix does not fit its page.** `TeamSettings.svelte` draws about 200 dropdowns in a table wider than the settings reading column (46rem), so Note, "Yours only", reset and remove sit behind a horizontal scroll; rungs of one model stand in the order they were added, apart from each other.

The list stays manual: the operator's edits over Tagma's shipped ratings, as today.

Mockup: http://localhost:5634/a/b001e6d24972

## Tagma's ratings for Claude and OpenAI

Claude and OpenAI carry most users, so Tagma ships ratings for their main rungs on every route to them; other providers ship none and their rows are the operator's alone, as today.

- `ANTHROPIC_TEAM` (Anthropic API and Claude Code): Opus 5.5 medium, high, xhigh; Sonnet 5.5 high; Haiku 5.5 xhigh, max; Fable 5.1 high, operator-only.
- `OPENAI_TEAM` (OpenAI API, ChatGPT sign-in and Codex CLI, which gains `team`): GPT-6.1 Sol high, xhigh, max; GPT-6.1 Terra xhigh, max; GPT-6 Luna medium; GPT-6 Astra high, operator-only. A row a route does not serve drops out there, as `teamOf` already does.
- The numbers, limits and notes are the operator's current list. Shipped rows still start off until chosen.

## What the agent receives

Each enabled row's line carries `spend` as rated and a non-zero favor as its own field: `open 6, depth 7, taste 8, ui 7, spend 3, favor +1`. The instruction above the lines gains one clause: favor is the operator's wish, not a cost; take the row meeting every need with the lowest spend minus favor. `teamModelsWords`, which tells working threads of a change, prints the same line.

## Review is chosen for the task

Review is picked per delivery like a child's model: the operator says which rows may review, and the agent chooses among them for the work at hand. There is no order.

- A row carries `reviews` beside `on`, written by the same `agent.models` edits, thread copy included; the whole-provider switch covers both. Shipped rows start with both off. Ratings are one set per row, used for both.
- `agent.review` keeps `reviewers` (0 for none, otherwise a ceiling the agent stays under) and `lenses`. `pool` and `split` go: a stored pool lands once as `reviews: true` edits on its rows, in machine, project and thread layers alike; the split follows from lenses — none chosen, each reviewer reads the whole; chosen, the first reads the whole and each next one a lens.
- The `spawn_agent.model` description lists every row that works or reviews, whatever the reviewer count; a row that reviews is marked `reviews`, one that only reviews `review only`, and starts reviewers alone.
- The review line names no models: up to N reviewers, picked for the delivery from rows marked for review by their ratings, as a child's model is, an exhausted account skipped. With 0 reviewers or no row marked, "Review: none". Tagma adds no preference of its own among them (rule c9e0cb28): the choice follows the operator's ratings alone.

## The Team section

Everything the composer's Team button controls gets one section in Settings, **Team**, under Agent: Delegation (`agent.delegation`, `agent.subAgentDepth`), Models for sub-agents (`agent.models`), Review of sub-agents' work (`agent.review`: Reviewers, then What they look at as lens chips, with one line naming the rows now marked for review). The keys keep their ids; the section is declared by the app and leaves the Agent page. The Team menu's "Edit list…" and Depth open it at their key.

In the Team menu, Reviewed by takes the shape of Agents run on: the Reviewers stepper, the rows that may review grouped by provider with their rung buttons, lens chips, Edit list…; its trigger reads "Up to N", or "Nobody". The "In order of preference" list and "Choose models" go.

## The list

- One sentence above it: agents start a child on a checked row, the cheapest whose ratings meet the task; click a row to rate it.
- Column names once: Open, Depth, Taste, UI, Spend. The list fits the reading column with no horizontal scroll.
- Groups by provider route as now: the whole-provider check, the provider mark and name, its quota gauge. A provider switched off is one line with its row count.
- Rows of one model stand together in ladder order (the `modelLines` grouping the Team menu already uses), the model name on the first, each rung dimmed after it.
- A row: two checks, Work (`on`) and Review (`reviews`); name and rung; per axis a 10-tile crest (`TileMeter`) and the number, blue (`--mutation`) where the operator's edit differs from Tagma's rating; then in words a non-zero favor ("+2 more often") and limits ("only research, docs", "never design", "on your word"). A row with neither check is dimmed. The row body opens its card; the checks only toggle.
- Add model keeps its catalog search; the added row opens its card.

## The card

Opens inline under its row, one at a time:

- Header: model, rung, route; Reset to Tagma's (when the row differs from its shipped one) and Remove.
- One line per axis: name, a one-line hint of what 1 and 10 mean, the crest, a `Stepper`, and where edited "Tagma's N", which reverts that field. A row Tagma ships no rating for says so once.
- Preference: favor −5…+5 on a `Stepper` with its word (less often, as rated, more often) and a hint that it tilts the choice without touching ratings.
- Only for and Never for as toggle chips of the eight kinds of work; a kind stands in one of the two at most. The chips are the review form's lens chips extracted into one shared component.
- Note (up to six words) and "Only when I name it" (`operatorOnly`).
- Agents read: the exact line `modelChoiceWords` delivers for this row, updated as the operator edits; a row with neither check says agents are not offered it.

## Architecture

- Ratings stay data in each adapter's `ProviderDescription.team`; nothing else learns provider names.
- The line format changes only in `team.ts` (`rowWords`, `modelChoiceWords`, `teamModelsWords`, `reviewers`, `reviewWords`); the card shows that same line through an export of `rowWords`, never a second formatter.
- `reviews` joins `TeamModelEdit` and `TeamModel`; `ReviewPolicy` drops `pool` and `split`, and the decode of a stored policy carrying them turns the pool into row edits once. `ReviewForm`, `ReviewMenu` and the pool helpers in `team/edits.ts` change to match; the sub-agent team line (46e7ebcd) keeps its fingerprints over the new shape.
- `TeamSettings.svelte` is rebuilt from existing parts — `TileMeter`, `Stepper`, `ProviderHeading`, `Usage`, `modelLines`, the add popover — and the Agent section drops `agent.models`, `agent.review`, `agent.delegation` and `agent.subAgentDepth` into the new Team section.

## Acceptance criteria

- A newcomer with Claude Code, Anthropic API, ChatGPT, OpenAI API or Codex CLI connected sees the listed rungs of that route rated, unchecked.
- A row with spend 1 and favor +1 is delivered as `spend 1, favor +1`; favor 0 adds nothing to the line.
- Settings → Team holds Delegation, Models for sub-agents and Who reviews; the Agent page no longer holds them; "Edit list…" opens Team at the list.
- The list has no horizontal scroll at the reading width; rungs of one model are adjacent in ladder order; an edited value is blue and its card reverts it per field.
- The card's Agents read line equals the line in the `spawn_agent.model` description for that row.
- A row checked only under Review is listed as `review only` and named in no child's choice; the review line names no model and no order; 0 reviewers or no row marked delivers "Review: none".
- A stored policy with a pool reads back as those rows marked for review, and no `pool` or `split` is written again.
- Typecheck and the affected packages' tests pass; minimal contract tests: the delivered line with favor, the shipped rows per route.
