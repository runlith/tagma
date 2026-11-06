---
id: 01a1788a-82be-7963-ab97-da3159a77704
title: "The Tagma plugin catalog: ready-made installs in one click, forks in one agent request, and custom plugins from a prompt"
ord: 5
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a11db3-63a5-7977-ae50-3e0cb27c8519
  - kind: relates
    to: 01a14c37-8e71-7053-9adc-c10225c23522
---
**Question.** Make a place in Tagma holding ready plugins, where each supports three one-action things: install it; fork it into your own and reshape it with one agent request; ask an agent to build a new one from a prompt. Then Tagma is not only the environment where plugins are built but a marketplace and a collection of ready ones.

In the terms of spec [[d2b5f488]] the catalog's unit is the plugin, shown in the Plugins screen's marketplaces.

**Why.** A newcomer need not know what a plugin's process or manifest is: they take a ready one. An experienced user starts from a fork, not an empty directory. Authors get a showcase.

**What exists and what is missing.** A plugin in Tagma's format is a directory with `tagma-plugin.json`, and editing its files restarts the process live. So a fork is mechanically a directory copy under a new id into the project's `.tagma-plugins/` plus an agent request. Install is `install_plugin` from a folder, a git URL or a marketplace entry, and the Plugins screen lists the result. Two parts are missing:
- a marketplace carrying plugins in Tagma's format, with what ties a fork to its origin;
- a boundary for foreign code: a plugin's process runs as the OS user, with only install consent naming what it runs.

**What to decide.**
- The catalog's unit: only plugins, or also things that are not yet separate — tag dictionaries, pages.
- What ties a fork to its origin: a source link, pulling its updates, publishing the fork back to the catalog.
- Trust in foreign code on one-click install. Rule 0f144655 forbids a confirmation step before the act, so the plugin's rights and origin are shown on its card before the click, and the mechanism — the process sandbox or the manifest's permissions — protects, not an "Are you sure" dialog.

**Look.** The operator wants stylish UX/UI and will design it separately. Bounds of the Tagma grammar:
- the plugin card is a `rounded-lg` surface;
- an installed plugin's state (running, crashed, off) is a square tile, like a thread's;
- "recommended" is not gold: gold is only "you are here"; no decorative colour;
- the preview may be the plugin's live view in a sandbox instead of a screenshot — an assumption, not a decision.

**What will help decide.** [[b27c8519]] collects similar mechanics: the App Store in Kiro Crew Apps, remix in Grok Build, the "in-conversation app store" of Charming on Goose.

**Unknown.** Whether foreign plugins are needed when an agent builds its own in minutes; who the first authors will be; who moderates the catalog and how.
