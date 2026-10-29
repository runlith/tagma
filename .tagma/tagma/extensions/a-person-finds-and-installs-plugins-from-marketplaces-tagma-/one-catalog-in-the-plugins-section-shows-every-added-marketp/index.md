---
id: 01a18975-644d-7413-ab91-26fd16e751f3
title: One catalog in the Plugins section shows every added marketplace
ord: 2
tags: ["spec"]
fields:
  {
    "status": "open"
  }
---
## What the person gets

The Plugins section opens on a catalog of every added marketplace, with search and a marketplace filter. Each plugin card shows:
- its name and one line;
- what it brings: skills, MCP servers, agents and hooks, where the entry says so;
- where it comes from: Tagma, Anthropic, OpenAI or `owner/repo`;
- its trust label.

**Opening a card** runs the preview of [[38643816]]. It shows the author, repository, version, the components Tagma takes and ignores with their reasons, and the consent install will ask.

**Installing.**
- Install asks, as for MCP servers and skills, whether the plugin runs in all the person's projects or in this one. For the all-projects choice, `plugins.enabled` gains the person's own layer, and a project can turn an all-projects plugin off.
- When a plugin's remote servers need sign-in, the card then offers the sign-in of each, which the person starts. An agent's install never signs in.

**The rest of the section.** Installed plugins stay in their own list with their state. A part of the section manages the marketplaces: add by URL, refresh, remove. Each shows its label, the time of its stored revision and a failed refresh's error.

## Design

- **Data.** The catalog reads the live feed of `read_marketplaces`. The card's detail comes from the preview, so the interface never reads a package itself.
- **The connector list** stays in the MCP section until [[9668a6b0]] retires it.
- **Interface work** follows the `tagma-design` and `frontend` skills.

## Owners

- `app-plugins`.
- `plugins` (the person's layer of `plugins.enabled`).

## Acceptance

- `read_marketplaces` over two fixture marketplaces answers both lists with their labels and install states. A plugin enabled for all projects is offered in two projects, and is off in a project that turns it off.
- Interface tests only where the project's test rules allow them, and the typecheck of `apps/tagma/app` passes.
- What the screen looks like is not checked live.
