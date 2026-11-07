---
id: 01a1b3e0-3840-721f-8a36-224648d72b26
title: "Plugins travel: the SDK on npm with every release, Tagma's marketplace in Tagma's format, a project's plugin list and updates from every source"
ord: 9
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a1ad53-a8b9-7fa9-98a0-71655067fa15
  - kind: relates
    to: 01a1b32d-42a6-75fa-b388-7072f70d7231
---
Step 9 of [[d2b5f488]]. Read from the code at `376356c37` on 2026-11-07; nothing was run.

## Outcome

A plugin travels between machines and people without a Tagma checkout:
- an agent on any machine — a person's, a collaborator's, a CI runner — builds a plugin against `@runlith/tagma` from npm, at the version of the Tagma it targets;
- Tagma's marketplace offers plugins in Tagma's format beside the Claude Code ones;
- a project names the plugins it uses, and a collaborator who opens it is offered each one;
- every installed plugin knows when its source has a newer version it may take, and updates in place.

The parent spec decided all four; only the marketplace was ever built, and only for Claude Code lists.

## What stands

- **The SDK is not on npm.** The registry answers `Not found` for `@runlith/tagma`. `kit/build.ts` emits `dist/` with a `package.json` that says `private: true`; nothing publishes it. The template (`src/plugin/template.ts`) pins `"@runlith/tagma": "^0.1.0"` from the SDK's own `package.json`, so `bun install` in a new plugin folder fails on every machine outside the runlith workspace, where plugins resolve the SDK as `workspace:*`.
- **Releases** are semver numbers stamped as `BUILT_RELEASE` (`platform/contract/wire/program.ts`; the dev channel reads `0.1.0`). `publishRelease` (`cut/publish.ts`) uploads the files, `release.json`, `feed.json` and the `latest/` DMGs, verifies them, then tags `v<n>`.
- **Bun** runs the SDK's bin (`#!/usr/bin/env bun`) and its build (`Bun.build`). The `plugins` skill tells an agent to install Bun with `curl … | bash` when the machine has none. Tagma ships a Bun runtime and already runs its package manager as `process.execPath` with `BUN_BE_BUN=1` (`plugins/sources.ts`), but agents' shells do not reach it: the world directory first on their PATH holds only the `tagma` command.
- **Tagma's marketplace** is the shipped preset `tagma`, the git repository `runlith/tagma-plugins` (`marketplaces/contract/wire/presets.ts`). Lists are read in two formats, Claude Code's then Codex's (`ListFormats`, `composition/runtime.ts`). A list entry's npm, archive and command sources are refused (`plugin-formats/claude-code/list.ts:82-95`). A list entry pointing at a folder with `tagma-plugin.json` already installs in Tagma's format, since that format prevails (`plugins/reader.ts:50-80`).
- **Updates** exist only for marketplace installs: the window compares the entry's version with the installed one by inequality (`features/plugins/here.ts` `newerOf`), and `update_plugin` refuses every other source (`plugin-without-marketplace`). Nothing reads npm or git for newer versions, and no range is recorded.
- **`.tagma-plugins/plugins.json` does not exist.** Nothing lists a project's plugins, and a project's own `.tagma-plugins/<id>/` folders appear nowhere until someone installs them by path.

## The SDK on npm

**One version, one release.** Each Tagma release publishes `@runlith/tagma` at the release's own number, built from the cut commit. The kit writes `dist/package.json` with that version and without `private`. `publishRelease` publishes it after `verified` and before the tag, so a release whose SDK did not publish is not tagged and the same command takes it up again. A version already on the registry with the same tarball is skipped; one with different bytes refuses, like a file under a published number. The npm token is one more variable of the same env file, passed the same way as the bucket keys.

**A plugin targets the Tagma that made it.** The template pins the SDK at exactly the running release (`PROGRAM_RELEASE`), not at `^`: while rule [[0528876d]] stands, no other version promises to fit. The build writes the SDK version into the manifest (`build.sdk`). A plugin the running Tagma refuses reads broken as now, and the **Fix with an agent** thread carries both versions, so the agent installs the running release's SDK and rebuilds.

**The developer channel** has no published number. A checkout server writes `"@runlith/tagma": "link:@runlith/tagma"` into a new plugin folder and, at start, registers its checkout's `packages/tagma` as that Bun link, so a folder anywhere on the developer's machine builds against the checkout it runs. The text is machine-independent; another developer's checkout serves the same name.

**Bun for every agent.** Agents' PATH, which already starts with the installation's world directory (`installation/setup/launcher.ts` `ensuredPath`), ends with a directory of the installation holding `bun` and `bunx` over Tagma's own runtime (`BUN_BE_BUN=1`). A machine's own Bun comes first; a machine with none still has one, so an agent installs a plugin's dependencies and builds it where the person installed nothing but Tagma. The skill drops the `curl` install.

## Tagma's marketplace in Tagma's format

**Tagma's list format.** `plugin-formats/tagma` gains a list reader for `tagma-marketplace.json` at a marketplace's root, read before Claude Code's and Codex's when present, as Tagma's plugin format prevails over theirs. It is the superset: its entries name plugins in any format Tagma reads, and its sources are a relative folder, git (`url`, `path`, `ref`, `sha`) and npm (`package`, `version` range). Entry fields: `name`, `source`, `description`, `category`, `tags`, `version`. A Claude Code or Codex user keeps reading the repository's own lists, which name only what their client installs.

**npm entries everywhere.** Since `plugins` installs from npm (step 8), a Claude Code list's npm entry installs too; archive and command sources stay refused with their reasons.

**`runlith/tagma-plugins`** gains `tagma-marketplace.json`, listing every entry it carries, and its first plugins in Tagma's format, built against the published SDK with their build output committed. A workflow in that repository rebuilds every Tagma-format plugin against the newest `@runlith/tagma` each night and on dispatch — the release skill dispatches it after a publish — commits the output that changed, and fails on a plugin that no longer builds, which an agent then fixes. The server's itest copy of the repository (`composition/testing/plugins/tagma-plugins`) follows it.

## A project's plugins

**`.tagma-plugins/plugins.json`** is committed and written only by Tagma. **Add to `<project>`** lists the plugin with its source, **Only for me** does not, and removing a plugin from the project drops its line. A line names the source a collaborator can reach: a marketplace entry by the marketplace's own source (its git URL, never this machine's id for it) and the entry's name, a git source, or an npm package; and the version range the project takes, `^` of the installed version by default. A plugin installed from a folder outside the project has no source a collaborator can reach and is not listed; the card says so.

**Plugins built in the project** are found by their folders: each `.tagma-plugins/<id>/` holding a manifest some format reads stands in the project's group with the project as its source.

**A collaborator.** The project's group on the Plugins screen shows every listed plugin and every project folder this machine has not installed, each with **Install**, which installs it from its source within the range and enables it in this project; a listed marketplace the machine lacks is added by the same act. Nothing installs on its own.

## Updates

- **Every source but a folder is checked**: a marketplace entry's version, the npm versions within the range, a git ref's head commit (a pinned commit is never newer). The range is the project's line, else the one recorded at install (`npm:name@range`), else none: the newest.
- **When.** At most once a day per source, from the plugins module's own daily driver, and when the Plugins screen opens, at most once in ten minutes per source. A check that fails keeps the last answer and says when it failed.
- **The card** reads "Update to X" with **Update** in place, for every source. `update_plugin` prepares the newer revision from the plugin's own source within its range and installs it under the one install lock; `plugin-without-marketplace` goes. Version order is semver, not inequality.

## Modules

- `packages/tagma` (kit): the published manifest, `build.sdk`, the exact pin and the link form of the template.
- `cut`: the npm publish step of `publishRelease`.
- `plugin-formats/tagma`: the list reader; `plugin-formats/claude-code`: npm entries.
- `plugins`: `plugins.json`, project folders found, the collaborator's Install, range on the install record, update checks and their driver, `update_plugin` for every source (moved from `marketplaces` if its prepare no longer needs a list).
- `installation`: the directory of `bun` and `bunx` over Tagma's runtime, last on agents' PATH.
- `app-plugins`: the project group's listed and found rows, **Update** for every source.
- Text: the `plugins` skill (installing dependencies, building, the pin, `plugins.json`), the SDK spec's Versions section ([[5067fa15]]), explanations of marketplaces (`f6b3083a`, `57e5f6ba`) and the template (`e87c56d4`).

## Acceptance

Performer checks, each through the door a real caller uses.

- **Publishing.** `publishRelease` against a local registry stub publishes `@runlith/tagma` at the release number before tagging; a second run skips it; different bytes under that number refuse.
- **Building from npm.** A folder from `create_plugin` on a release server pins the running release; `bun install` from the stub registry and `tagma-plugin build` succeed with no checkout, and `install_plugin` installs it.
- **No Bun.** With no Bun on PATH but Tagma's, an agent's shell runs `bun install` and `bunx tagma-plugin build` in that folder.
- **The developer channel.** A folder created by a checkout server outside the workspace builds against that checkout's SDK.
- **The list.** A marketplace with `tagma-marketplace.json` lists a Tagma-format plugin, a Claude Code plugin and an npm entry; each previews and installs. A Claude Code list's npm entry installs.
- **The project's list.** **Add to `<project>`** writes the plugin's line into `plugins.json`; **Only for me** writes nothing; removing it from the project drops the line.
- **A collaborator.** A second server opening the same checkout shows the listed marketplace plugin, the listed npm plugin and the project's own folder with **Install**; Install takes each from its source within the range, adding the listed marketplace when missing.
- **Updates.** A newer npm version within the range, a marketplace entry with a higher version and a moved git ref each read "Update to …"; a version outside the range does not; **Update** installs it.

## Open for the operator

- **npm.** The `@runlith` scope on npm and a publish token in the release env file are the operator's to create; until then the publish step refuses and names the variable.
- **The marketplace's first plugins in Tagma's format** are a product choice.
- **Pushing** to `runlith/tagma-plugins` — its list, its plugins and its workflow — is an act outside the machine.

## Not established

- Whether `link:` resolves through Bun's global link store for Tagma's own runtime under `BUN_BE_BUN=1` the way it does for an installed Bun.
- Which Bun command reads the versions of an npm package honouring `.npmrc` without installing it.
