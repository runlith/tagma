---
id: 01a18975-644d-7413-ab91-26fc38643816
title: Tagma reads Claude Code and Codex marketplaces and installs a plugin from an entry
ord: 1
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a1897e-a2d4-7c95-a8a8-939b43cce814
---
## What the person gets

The person or an agent adds a marketplace by its git URL or a folder, and reads its entries. The person installs a plugin from an entry with the consent install already asks.
- **Presets.** Anthropic's and OpenAI's marketplaces stand in the list from the first start. A preset the person removes stays removed.
- **Updates.** An installed plugin remembers its marketplace entry, so an update follows the marketplace's stored list. Refreshing a list never changes installed code; updating is its own act, and it asks consent again.

## Today

- **Sources.** `install_plugin` takes a folder or a git URL (`plugins/sources.ts`, `PluginSource`). A git URL is cloned whole with `--depth 1`, with no subdirectory, ref or commit. A folder is read in place.
- **Formats.** A plugin directory is read by two format adapters, `plugin-formats/claude-code` and `plugin-formats/agent-plugins`. `PluginFormat.read` receives no marketplace entry.
- **Installs.** They are keyed by the plugin id, and another source under a taken id is refused `plugin-id-taken`.

## Owners and direction

- **The new `marketplaces` module** owns:
  - registered marketplaces and their fetched lists, a stored revision per marketplace;
  - entry identity, which is the marketplace's id plus the entry's name;
  - resolving an entry into a plugin source.
- **List formats are adapters** behind its contract, one per format; the core names no format.
- **`plugins` stays the only owner of a package:** preparation and the consent computed from it, install, update and installed state.
- **Direction.** `marketplaces` calls the `plugins` contract and never the reverse: an entry's resolved source goes to `plugins`.

## An entry becomes a source

- **Kinds.** A resolved source is a git URL with a subdirectory, a ref and a commit, or a folder. Beside it rides the manifest the entry declares, if any. Both are recorded on the install together with the marketplace entry identity.
- **Kinds Tagma installs:** relative path, `github`, `url` and `git-subdir` for Claude Code; `local`, `url` and `git-subdir` for Codex.
- **Kinds listed with a reason and not installable:** `npm`, `archive` and `command`. A `command` source runs a program at install, outside Tagma's consent model.
- **Pinning.** A pinned `sha` installs that commit or nothing. A relative or `local` path that escapes the marketplace root is refused, and one invalid entry never hides the valid ones.
- **Claude Code entries combine with the manifest by the client's rules** ([[43cce814]]):
  - no manifest: the entry is the manifest;
  - manifest with `strict: true`: the entry's component fields are appended;
  - manifest with `strict: false` and entry components: a conflict, refused with that reason.

  The Claude Code format adapter takes the entry as part of what it prepares, through a format contract `plugins` declares. The plugins core never reads Claude fields.

**The installed package is a snapshot.** Installing copies the prepared package into the plugin's own directory and records on the install the manifest the entry declared, which the format adapter combines with the package on every read. An installed plugin never reads from a marketplace clone. Refreshing or removing a marketplace leaves every installed plugin working. A plugin whose marketplace is gone no longer updates, and an update asks answers a typed refusal saying why.

**Identity.** The plugin id stays global, as installs are today. An entry whose plugin id is already installed from another source reads `taken by <source>` in the list and refuses to install. This holds for same-named plugins in two marketplaces too.

**The Codex plugin format is a third plugin adapter.**
- **What it reads.** It reads a legacy `.codex-plugin/plugin.json` directory: skills, the remote servers of its `.mcp.json` (signed in through the MCP layer), and `interface` as display data.
- **What it lists as ignored.** `.app.json` is listed as ignored, with the reason that it names a ChatGPT connection. `policy` and `products` are display-only and never install or authenticate anything.
- **A root manifest beside the overlay.** Where an Agent Plugins `plugin.json` stands at the root next to an OpenAI overlay, the builder reads OpenAI's packaging definition and implements its precedence. Hooks found there run through the one hook runner `plugins` owns; a format adapter never imports another adapter's internals.

**Fetching and staleness.**
- Lists are fetched only when a marketplace is added and when the person refreshes it. A git marketplace is fetched as a shallow clone in the machine data directory; a folder is read where it stands.
- A failed refresh keeps the last valid revision and shows the error and the time of that revision.
- Presets are registered once and fetched in the background at first start, never blocking it.

**Trust.**
- The label is Tagma's: `tagma` for Tagma's own marketplace, `vendor` for the preset Anthropic and OpenAI marketplaces at their fixed URLs, and `unreviewed` for anything the person adds.
- A marketplace's own name or owner field never grants a label.
- An entry shows its author, repository and marketplace before install.
- Consent stays as `install_plugin` computes it.

**Preview before install.** `preview_plugin` resolves the entry and has `plugins` prepare its package; `plugins` holds that revision and answers its inventory, what is taken and ignored, the consent it will ask, and its metadata. `install_plugin` with the prepared revision then acts on it, without a second clone. A held revision is dropped a day after it was prepared, and staging is cleared at server start.

**Operations.**
- `add_marketplace`, `remove_marketplace` and `update_plugin` are operator-only.
- `refresh_marketplace`, `read_marketplaces` and `preview_plugin` are open to agents.
- `read_marketplaces` answers each entry with its install state, read from the authority `plugins` holds.
- The lists and install states are a live feed.

## Acceptance

Fixture marketplaces are local git repositories in the test world, one per format. Every check runs through the operations.
- **Installing.**
  - Each installable source kind installs. A pinned `sha` installs that commit, and an unreachable pin is refused.
  - Each Claude combination behaves as above: no manifest, appended components, conflict.
  - A Codex legacy plugin installs with its skills and remote server, with `.app.json` listed as ignored.
  - Preview, then install, uses one prepared revision.
- **Refusals and the list.**
  - An invalid entry beside a valid one leaves the valid one installable.
  - A path escaping the root is refused, and an `npm`, `archive` or `command` entry is listed and refused.
  - Same-named entries in two marketplaces read one installed, the other taken.
- **Marketplace lifetime.**
  - After a list refresh, a marketplace removal and a server restart, the installed plugin's skill is offered and its MCP tool answers, unchanged.
  - Refresh alone changes no installed plugin, and an explicit update moves it and asks consent.
  - A failed refresh keeps the prior revision and reports the error.
- **Presets.** A fresh data directory registers the two presets as `vendor`, and a removed preset stays removed after restart.
