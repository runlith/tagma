---
id: 01a1b1a5-853b-79d5-a584-bd482efe2161
title: A plugin asks a model once on the person's accounts, and its card shows what the asks spent
ord: 10
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a1ad4a-de84-7ddc-9396-cf6ac4451a7e
sources:
  - kind: file
    ref: apps/tagma/server/src/providers/askCalls.ts
  - kind: file
    ref: packages/tagma/src/plugin/models.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugins/Asked.svelte
---
**Value.** A plugin that needs a model's judgement once — grade a sentence, sort a note, write a title — gets it without starting a thread, and the person sees what it spent.

**How.** The plugin's process calls `ctx.models.ask(prompt, {schema})`; behind it the external operations `ask_model` and `read_model_menu`. The model is the person's choice in `ask.model`, or one the plugin names from the menu. The plugin's card in Plugins shows what its asks spent.

**Behaviour.**
- With a Standard Schema (zod, ArkType, Valibot) the SDK sends its JSON Schema and parses the answer with it, so the author gets a typed value; an answer off the shape throws.
- A named model that cannot answer refuses `ask-unanswerable`; it is never swapped for another.
- The ask runs on the person's accounts and is recorded as the plugin's. The card names the period it counts, the hours `activity.keepHours` keeps, and shows asks, tokens read and written and the asks that got no answer; it is hidden while there are none.

**Limits.** Nothing is cached, and a plugin has no budget of its own: every ask spends.
