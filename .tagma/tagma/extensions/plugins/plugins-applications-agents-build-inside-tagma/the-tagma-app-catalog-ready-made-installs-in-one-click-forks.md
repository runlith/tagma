---
id: 01a1788a-82be-7963-ab97-da3159a77704
title: "The Tagma app catalog: ready-made installs in one click, forks in one agent request, and custom apps from a prompt"
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
**Question.** Make a place in Tagma holding ready apps, where each app supports three one-action things: install it; fork it into your own and reshape it with one agent request; ask an agent to build a new one from a prompt. Then Tagma is not only the environment where apps are built but a marketplace and a collection of ready ones.

**Why.** A newcomer need not know what a plugin, process, or manifest is: they take a ready one. An experienced user starts from a fork, not an empty directory. Authors get a showcase.

**What exists and what is missing.** A plugin is a directory with `plugin.json`, and editing its files restarts the process live. So a fork is mechanically a directory copy under a new id into the project's `.plugins` or personal plugins plus an agent request. Install is `install_plugin` and `enable_plugin`. Three parts are missing:
- a source outside the machine;
- the app's plugins screen — [[25c23522]] waits for it;
- a boundary for foreign code: the plugin process now runs as the OS user with no questions asked.

**What to decide.**
- The catalog's unit: only plugins, or also things that are not yet separate — agents, skills, tag dictionaries, pages. One showcase for all kinds, or a plugin as the package carrying them.
- Where the catalog lives: git repositories or the Agent Plugins `marketplace.json`. With the latter, plugins written for other clients enter the catalog too.
- What ties a fork to its origin: a source link, pulling its updates, publishing the fork back to the catalog.
- Trust in foreign code on one-click install. Rule 0f144655 forbids a confirmation step before the act, so the app's rights and origin are shown on its card before the click, and the mechanism — the process sandbox or the manifest's permissions — protects, not a “Are you sure” dialog.

**Look.** The operator wants stylish UX/UI and will design it separately. Bounds of the Tagma grammar:
- the app card is a `rounded-lg` surface;
- an installed app's state (running, crashed, off) is a square tile, like a thread's;
- “recommended” is not gold: gold is only “you are here”; no decorative color;
- the preview may be the plugin's live view in a sandbox instead of a screenshot — an assumption, not a decision.

**What will help decide.** [[b27c8519]] collects similar mechanics: the App Store in Kiro Crew Apps, remix in Grok Build, the “in-conversation app store” of Charming on Goose.

**Unknown.** Whether foreign apps are needed when an agent builds its own in minutes; who the first authors will be; who moderates the catalog and how.
