---
id: 01a1564c-cb73-7d10-856a-5bf8c19d5d0e
title: "Step 1 · A new user finds no entry into the law in the product: the Rules screen is empty, and nothing leads further"
ord: 15
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "refuted"
  }
edges:
  - kind: validates
    to: 01a14c14-a11c-7ce8-9d84-633958074d0c
---
## Hypothesis

A person who bought Tagma to protect their architecture opens their project and learns from the product itself where to start.

## Setup

- law-lab at commit `12cfb2a`: an expense-tracking app, not a single rule or module in the graph. Tagma is runlith at `887c1efb58`.
- Looking at what a new user sees without an agent: the project's Rules screen and the new-project dialog.

## Observation

- The Rules screen (`apps/tagma/app/src/lib/features/rules/RulesPage.svelte`) with an empty law shows only the "Rules" heading and the line "0 of 0 rules checked by Tagma". No hint, button, or suggestion to talk to an agent — by the code and on screen, which the operator opened on 2026-10-19.
- The new-project dialog asks for a folder, a name, graph storage and directories; nothing about the law in it.
- The `rules` agent (`native-harness/agents/rules`) can measure a project and propose checks, but no surface leads a person to it.

## Conclusion

There is no entry into the law for a new user: they have to guess that they should write to an agent in chat. Direction from the operator: the entry must work with any agent — the built-in default or the user's own agent — so it is closer to a skill (possibly a skill plus a separate agent) than to a separate agent alone; whether the `rules` agent is still current was not checked.

**What the user had to know or do on their own:** guess that the law is started by talking to an agent, and with what words.
