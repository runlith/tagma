---
id: 01a189aa-af25-74f6-a2b5-421c57e5f6ba
title: A person installs a plugin from Anthropic's, OpenAI's or any added marketplace
ord: 3
tags: ["feature"]
fields:
  {
    "state": "partial"
  }
edges:
  - kind: relates
    to: 01a18926-2da8-763c-ae41-cdf18b835e91
sources:
  - kind: file
    ref: apps/tagma/server/src/marketplaces/marketplaces.ts
  - kind: file
    ref: apps/tagma/server/src/marketplaces/contract/wire/operations.ts
---
**Value.** A person finds a plugin in the marketplaces of the ecosystem — Anthropic's, OpenAI's or any other git repository or folder carrying a Claude Code or Codex list — instead of having to know its folder or git URL, and installs it with the consent installing already asks.

**How.** `read_marketplaces` lists each marketplace with its trust label and stored list, and its entries with their install state; `preview_plugin` prepares an entry and answers what Tagma takes and ignores, the consent it will ask and who made it; `install_plugin` with the prepared revision installs it. `add_marketplace`, `remove_marketplace` and `update_plugin` are the operator's; `refresh_marketplace` and the reads are open to agents. The `marketplaces.subscribe` feed carries the lists and install states live.

**Behaviour.**
- Anthropic's and OpenAI's marketplaces stand in the list from the first start, labelled `vendor`; one the person removes stays removed.
- A list is fetched only when added or refreshed; a failed refresh keeps the stored list and shows the error beside it.
- Relative and `local` paths, `github`, `url` and `git-subdir` entries install; a pinned commit installs that commit or nothing. `npm`, `archive` and `command` entries are listed with the reason Tagma does not install them, and one invalid entry hides none of the others.
- A Claude Code entry combines with the plugin's own `plugin.json` as Claude Code combines them.
- An installed plugin is a copy: refreshing or removing its marketplace never changes it, and `update_plugin` moves it to what the stored list says.
- A plugin's id is global: an entry whose plugin is installed from elsewhere reads `taken` and refuses to install.

**Limits.** The Plugins section of the app does not show the catalog yet. Marketplaces served as a single `marketplace.json` URL, npm packages, zip archives and command sources are not installed.
