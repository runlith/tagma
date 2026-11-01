---
id: 01a14aaa-f6e0-7c98-9b30-35991073a31c
title: "Former `code` threads continue on tagma with an overlay without graph and speech: steps rename the agent, keep the overlay narrowing"
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/drizzle/20261017161000_developer_retired/migration.sql
  - kind: file
    ref: apps/tagma/server/drizzle/20261020153000_rules_retired/migration.sql
  - kind: file
    ref: apps/tagma/server/src/native-harness/steps/retired.ts
---
A thread stores its agent (`agent_id`, `transport.agent`) and the profile overlay (`profile.overlay.baseAgentId`, `capabilities`) in both the database and the rollout-file meta. When a built-in agent leaves, its threads move to the heir by renaming, while the overlay `capabilities` are untouched: the overlay only narrows the base, so a continued thread keeps exactly the same tool set. That is how `code` threads after the `developer_agent` migration and step stand on `developer` with an overlay without `graph`, and after the `developer_retired` migration and step on `tagma` with the same overlay (profile id `tagma`). Overlay-less `developer` threads become plain `tagma` threads and gain `speech`. The `rules_retired` migration and step move the departed `rules` agent's threads to `tagma` the same way.

Widening the overlay to the heir's full set would silently hand the old thread a graph it never saw in its history or system prompt. Steps work as a chain by name: a `code` thread's rollout passes both and arrives at `tagma`.
