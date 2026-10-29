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
- what it brings: skills, MCP servers, agents and hooks, where the entry or the package says so;
- where it comes from: Tagma, Anthropic, OpenAI or `owner/repo`;
- its trust label.

Opening a card shows the author, repository, version, the components Tagma takes and ignores, and the consent install will ask. One act installs it and enables it in this project. Installed plugins stay in their own list with their state. A part of the section manages the marketplaces: add by URL, refresh, remove.

## Design

- **One place to add abilities.** Until Tagma's marketplace carries the services ([[9668a6b0]]), the connector list stays in the MCP section. That part retires it.
- **What a card says before install** comes from the entry, plus the same reading `install_plugin` already does before consent ([[39cdfe48]]); the catalog does not read a package twice.
- **The trust label** is the marketplace's, never the plugin author's word.
- **Interface work** follows the `tagma-design` and `frontend` skills, and the catalog is a live feed of `read_marketplaces`.

## Owners

- `app-plugins`.

## Acceptance

- The catalog lists the entries of two fixture marketplaces with their labels.
- The filter narrows to one marketplace.
- Installing from a card runs `install_plugin` with the entry and shows the consent.
- An installed entry reads installed in the catalog.

Unit and component tests only where the project's test rules allow them; the typecheck of `apps/tagma/app` passes.
