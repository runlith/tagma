---
id: 01a1ad4a-a9f0-7e77-9b01-4d7dd2b5f488
title: "Plugins: one unit from a theme to a whole application, written in code against a published SDK"
ord: 57
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a118ac-1a50-7aba-9bbf-abf721acc718
  - kind: relates
    to: 01a1231f-29af-74c6-9e71-e4a62243eda2
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b09415a61526
  - kind: relates
    to: 01a1696f-9c19-712f-abc1-abc6d5c27a25
  - kind: relates
    to: 01a1788a-82be-7963-ab97-da3159a77704
  - kind: relates
    to: 01a184a7-bd46-7bf8-8006-9e1db540be67
  - kind: relates
    to: 01a18921-8504-7058-9d53-62c5e9aa47fc
  - kind: supersedes
    to: 01a1ad0c-9c6d-75f8-b5b7-b2a7c1891844
---
Read from the code at `11f23bfc7` on 2026-11-05; nothing was run. The agent layer is the child spec [[c4451a7e]].

## Outcome

A person, or an agent working for them, extends Tagma through one thing: the plugin. A plugin may be a theme, a sidebar button, a section for a service, a separate tool such as a language trainer, a launcher-style window over Tagma's agents, or a model, harness or speech provider. Size changes what it declares, never what it is.

- It is written in TypeScript against the published `@runlith/tagma-sdk`, and `npm create tagma` starts one.
- It is installed by one act from a folder, git, npm or a marketplace entry, and listed on the one Plugins screen.
- Plugins in the Claude Code and Codex formats install through the same act and the same list, with their source marked.
- An MCP server stays a connection with its own list.

## Decided with the operator on 2026-11-05

- **One term.** The product says plugin. "App" leaves the product vocabulary, and promotion may still use the word. "Tagma app" is never used, because it names the client itself.
- **Our format is the full one.** Foreign formats are translated into it by readers the person never sees.
- **A bare MCP server is not a plugin.** It is a connection, a command or URL with its secrets and sign-in, and carries no author, version or files. It keeps its own list. A plugin may bring servers into that list, marked with the plugin and switched with it.
- **Everything at the side is a plugin:** model and harness providers and speech providers too. A built-in one ships with Tagma as a plugin.
- **MCP is the wire.** A plugin process speaks MCP over stdio, which is what lets it be written in any language.
- **Code, then manifest.** The author writes code. The SDK's build emits the manifest Tagma reads without running the plugin, and nobody writes it by hand.
- **All three depths on the agent layer are needed.** A plugin can run its own chat over our agents, show our thread, and add to our chat. They are built in that order.
- **The Plugins screen stays the one home.** Apps get no screen of their own.

Trust and consent at install are not part of this spec.

## What stands

| Installs | Owner | What it takes | How it runs |
|---|---|---|---|
| `install_app`, `enable_app`, `uninstall_app` | `tagma-apps`, `views`, client `app-tagma-apps`, `app-views` | A directory holding a hand-written `tagma-app.json` | One MCP stdio process per machine, contributions by owner-declared points, views in iframes on the app's own origin |
| `install_plugin`, `enable_plugin`, `update_plugin` | `plugins`, `plugin-formats/*`, `marketplaces`, client `app-plugins` | Claude Code, Codex and Agent Plugins packages | Skills, commands, agents, MCP servers and command hooks through the `plugin-hooks` rule |
| `install_adapter` and its family | `providers/adapters` | Model and harness adapters from npm, GitHub or a folder | Inside the server process: `importAdapter`, host modules, one directory per version |
| `add_mcp_server` | `mcp` | Connections | The project's MCP pool |
| none | `composition/speech.ts` | Speech providers | Compiled in |

Under all of it the core is sound. Contribution points are declared by their owners (`ContributionPoint`, explanation 7d2dc40e), and every operation carries a schema. What is missing:
- an SDK, a generator and a typed client;
- any proof of who a plugin is: `x-tagma-caller` proves nothing, and a local call without it is the operator;
- loading window code from outside the build;
- a theme point, keyboard shortcuts and window kinds for plugins;
- a second installer path for speech.

## The plugin

**Package.** A plugin is a directory holding:
- `tagma-plugin.json`, emitted by the SDK build from `definePlugin(...)`;
- the `.svelte` sources of its native views, or the built bundle of foreign ones;
- its process entry, if it has one;
- the files its contributions name.

The manifest is today's envelope (`TagmaAppEnvelope`: `id`, `title`, `process`, `contributes`) plus `version`, `engines.tagma` (a semver range of Tagma versions) and `providers`. The JSON Schema of the manifest stays generated from the declared points, as `read_app_schema` does now. A point stays its owner's to declare and to judge.

**Where each part lives.**

| Part | Lives | Reason |
|---|---|---|
| Theme, button, command, shortcut | Data in the manifest | No code and no process |
| Sections, panes, windows, slots in the chat, composer and sidebar | A module mounted in the window | Keys, menus, drag and Tagma's components work only in the window's document |
| Tools, agents, schedules, notifications, thread endings, build steps, hooks on tool calls | The plugin's own process | Any language, and a crash leaves the server standing |
| Model, harness and speech providers | Inside the server | The provider contracts share `effect`, `Held` and schema objects with the server (explanation 6cdd67c3), so they cannot cross a process boundary |

The graph, threads, law and gates are never plugins: the product's guarantees stand on them.

**Install and scope.** Install is a machine record and enabling is per project, which is the model both apps and agent plugins use today. Plugins a project builds for itself live in `.tagma-plugins/<id>/`, the successor of `.tagma-apps/<id>/`. The project offers them as installable from the project. Install accepts a folder, git, npm (versions resolved by semver, as adapters are now), or a marketplace entry.

**Process life.** A process starts on first demand: a tool call, a tick, a view's resource subscription, a thread ending owed to it. It stops after an idle period with no open subscription, unless the manifest marks it `resident` because it holds a live connection to a service. Today a process starts at install and runs until uninstall, which a machine with many plugins pays for in memory. Everything else stays as the supervisor holds it now (explanation 38074044):
- one process per machine;
- generations under the plugin's lock;
- restart on edit;
- backoff after a crash;
- calls during a restart waiting for the new process;
- the data directory outliving uninstall.

**Formats.** `plugin-formats/<format>` each read a directory into the one plugin description the `plugins` module installs. A new reader, `plugin-formats/tagma`, reads `tagma-plugin.json` and, during migration, `tagma-app.json`. A directory may carry manifests for several clients, as the plugins of Tagma's marketplace already do, and Tagma reads its own when present. Foreign formats keep:
- their `<plugin>-<name>` component names and collision rules;
- the list of what Tagma skips and why;
- their command hooks.

**MCP servers.** Declarations, the pool, sign-in and secrets stay with `mcp`. A plugin's servers reach the pool through the port `mcp` already opens to contributors. The screen lists servers apart from plugins, each server marked with the plugin that brought it. A server's MCP App window keeps its two-layer iframe proxy (explanation 960e5e20). The view that shows it becomes a module the MCP client owns, so the window's module host knows one kind of view.

## Interface

**Native views: Svelte, later Vigla.** The plugin ships `.svelte` source, and Tagma compiles it on its own. This happens at install and again after every Tagma update, in a worker (rule 7a910861), with the compiler and Tailwind the window was built with and the theme of `app.css`. Shipped compiled, a view would fail in two ways:
- It breaks on the next Svelte update, because a compiled component imports `svelte/internal/client`, the private API of one version (5.57.0 today).
- Its Tailwind classes would not exist, because Tailwind emits only classes found in the `@source` paths of `app.css`.

What Tagma promises about Svelte is its version 5 source language, never its internals. A source the current compiler rejects leaves the plugin `refused` with the compiler's message. The output is served under `/api/plugins/<id>/`, which is behind admission on the remote door (explanation 8c5b6812).

**Host module table.** The window's build emits stable chunks for `svelte`, `svelte/internal/client` and `@runlith/tagma-sdk/ui`. The shell document names them in an import map, and a compiled plugin imports them as bare specifiers. The window's own code imports the same chunks, so one runtime and one component set serve both. The list is short and versioned, as `hostModules` is for adapters.

**Foreign views: React or anything else.** The plugin ships a built bundle exporting `mount(element, tagma)`, which returns a disposer, and brings its own framework.
- It takes Tagma's look from the token CSS variables.
- It shows a thread through `tagma.thread(element, id)`, which the host draws.
- It survives Tagma updates while the promised calls hold.

**Placement.** Slots inside the chat, composer and feed take native views only, because a separate foreign root in each measured row of a feed is costly and fragile. Sections, panes and windows take either kind. `create-tagma` produces a native plugin, and agents write native by default.

**Where an iframe stays.** It is a component a module places inside itself, never a second kind of view in the host. It stays where the HTML is not ours:
- an MCP App window;
- someone else's site or widget;
- a finished web application a plugin brings whole and serves from its process;
- pages an agent writes, which stay on their own origin.

**Windows and shortcuts.** Any window Tagma opens loads Tagma's own client, so a plugin's window shows real threads as the main window does.
- A plugin declares keyboard shortcuts that open its views, or run a command its process serves.
- It declares windows: plain, without a frame, always on top.
- It declares a global shortcut that works while Tagma is not focused.

The shell already has all three for its own dictation pill and quick hide (`apps/tagma/desktop/src/main.ts`, `projectWindows.ts`). The shell opens them to plugins through declared entries, never by handing a plugin Electron itself. On the web, where no shell exists, such a window opens as a floating panel, as launcher views do now.

**Themes.** A `themes` point takes token values for light and dark: surfaces, text, brand, syntax roles and the terminal palette. The window's `Theme` service applies the chosen theme, and the terminal theme catalog lists it beside its own. The state colours keep their meaning. A theme may retune their values, but never swap one state's colour for another's.

**What is promised to a plugin** lives in the SDK as its public surface, and only that surface is versioned:
- the host module table;
- the slot faces of the child spec;
- the `tagma.*` calls;
- the shortcut and window entries;
- the theme tokens;
- the operations declared `external`.

## Modules after the change

- **`plugins` (server)** owns the one install act for every format: prepare, install, update, enable per project, uninstall, the machine record and each plugin's data directory. `install_app`, `enable_app`, `uninstall_app` and `read_apps` fold into `install_plugin`, `enable_plugin`, `uninstall_plugin` and `read_plugins`. Adapter fetching and records fold in too; adapter loading stays with `providers`.
- **`plugin-host` (server), today `tagma-apps`**, keeps the process supervisor, the contribution-point protocol and tool audiences. The name changes because "app" leaves the product. The caller becomes `plugin:<id>`, `bindings.app` becomes `bindings.plugin`, and plugin tools are named `plugin__<id>__<tool>`. Journal entries already written keep the names they carry.
- **`providers` and `speech`** load the `providers` part of an installed plugin. `providers` keeps its loader. `speech` gains one on the same model — host modules, one directory per version, a run pinning the catalog it started with — so a speech provider installs without a rebuild.
- **`views` (server) and `app-views` (client)** become the native module host: the compile pipeline, the module route, the host module table and the slot faces. The iframe frame and bridge stay as a component.
- **`app-plugins` (client)** draws the screen below.
- **`@runlith/tagma` becomes `@runlith/tagma-sdk`**, published on npm:
  - `/plugin`: `definePlugin`, the manifest build, a typed client of the `external` operations derived from their schemas, and a process wrapper that hides MCP from the author;
  - `/ui`: the host's components, `Thread` among them, and the tokens;
  - `/rules` and `/adapter/*`, as now.

  The bare `@runlith/tagma` stays reserved for the product itself. `create-tagma` is its own package.

## The Plugins screen

- The project's list has two groups: plugins, and MCP servers. A server a plugin brought is marked with that plugin.
- Plugins built in the project appear with the project as their source.
- The sources stay the marketplaces. Tagma's marketplace also carries full plugins. Anthropic's and OpenAI's are translated, and what Tagma skips is named.
- Providers install here. Their accounts and model choices stay in the model settings.
- A plugin's card names what it brings: tools, skills, agents, a section or window, a theme, a provider. It says whether the plugin runs a process on this machine.
- The header speaks of the window as well as of agents.

## Capabilities only a plugin reaches

`schedule`, `notify`, `on.ended` and `beforeBuild` stay points of a plugin, as typed fields in the SDK. Their engines are generic. `schedule` keys schedules by owner and delivers through the `TickReceivers` port, which only `composition/ticks.ts` fills today. Giving a thread a timed assignment without a plugin is idea [[d5c27a25]], outside this spec.

## Migration

- Existing app directories keep working: the `tagma` reader takes `tagma-app.json` as a manifest. They are rebuilt on the SDK at their owners' pace. Support for `tagma-app.json` and `.tagma-apps` ends once none remain.
- One start step moves the machine records:
  - `apps.installed` and `apps.enabled`, and the adapter records, become plugin records;
  - `app-data/<id>` stays where it is;
  - secret values move from owner `tagma-apps` to the plugin owner;
  - schedule grids keyed `app:<id>` move to the new owner, with no period shift.
- The `apps` skill becomes a `plugins` skill describing the SDK. Rule 7cb3c1cf follows it to the new paths.
- The block naming "app" as a product term ([[b540be67]]) and the apps feature ([[15a61526]]) are rewritten when the code lands.

## Order of work

1. **Identity.** The plugin grant and the bound scope (child spec).
2. **SDK and one install act.** `/plugin` with `definePlugin`, the manifest build, the typed client and the process wrapper; `create-tagma`; the `tagma` reader; install from folder, git and npm; lazy process start; migration of records.
3. **Depth 1 of the agent layer** (child spec).
4. **The window's module host.** The compile pipeline, the host module table and the module route. Native views replace iframe views. MCP App windows move to the MCP client's view. Then the theme point, shortcuts and window kinds.
5. **Depth 2:** our thread in a plugin (child spec).
6. **Depth 3:** additions to our chat (child spec).
7. **Providers as plugins:** adapters through the one install act, and the speech loader.
8. **Publishing:** the SDK and `create-tagma` on npm; full plugins in Tagma's marketplace.

The screen changes ship with the step that brings what they show.

## Acceptance

Performer checks, each through the same door a real caller uses:
- `npm create tagma`, then an agent adds a tool, a schedule, a notification and a native section. Building it emits `tagma-plugin.json`. One `install_plugin` from the folder installs it, and the plugin's process starts at the first tool call, not at install.
- A Claude Code plugin and a Codex plugin install through the same act, and `read_plugins` lists them beside the native one with their source and skipped parts. A plugin's MCP server shows in the server list marked with it.
- Every existing app directory installs and runs through `install_plugin` with its data, secrets and schedule grid intact.
- A native section imports a Tagma component from `@runlith/tagma-sdk/ui` and renders with the window's tokens. After Tagma moves to the next Svelte patch, it is recompiled and still renders.
- A foreign React bundle mounts in a pane and shows a thread through `tagma.thread(element, id)`.
- A theme plugin changes surfaces, text and syntax in both modes and the terminal palette, and leaves the state colours' meanings intact.
- Mod+J from a plugin opens a frameless always-on-top window holding a grid of four threads on four providers.
- A model provider and a speech provider install as plugins without a rebuild, and appear in their catalogs.
- The SDK's typed client offers exactly the operations declared `external`.

## Open for the operator

- Whether a project can declare the plugins it uses, so a collaborator opening it is offered them.
- The child spec's questions: a one-shot model call for plugins; whether a separate program beside Tagma is the operator or a caller he names; whether hooks ever reach a foreign CLI's own tools.
- The `TagmaApp` exception in rule eeaf88ec loses its subject once "app" leaves the product. Changing the rule is his.
- Registering `create-tagma` and publishing on npm are acts outside the machine.

## Risks

- **A public contract.** The SDK surface, the slot faces and the host module table become a versioned contract. That goes against the practice of one form changed in one commit, and only the surface listed above is promised.
- **Svelte versions.** A Svelte major version recompiles every native plugin and may refuse some.
- **Shipping weight.** The server ships the Svelte compiler and Tailwind's native binary on every platform.
- **Hangs and leaks.** A hung native module hangs the window, and a leak lives until reload. The Vigla idea [[6b792682]] would address both later; nothing here waits for it.
- **Lazy start.** It moves process start cost onto the first call.

## Not established

- That the window's Vite build can emit `svelte` and `svelte/internal/client` as stable chunks the app imports through an import map.
- The cost of compiling one plugin, and the order of its stylesheet against `app.css`.
- That the desktop window loads from the local door's origin, which serving modules same-origin assumes.
- Whether Electron shortcuts reach the window while focus is in an iframe, and whether the window survives a hung iframe.
- The memory of a plugin process at rest.
