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
Read from the code at `11f23bfc7` on 2026-11-05, and revised after a product review and an architecture review the same day. Nothing was run.

Two child specs carry the detail:
- [[5067fa15]], the SDK: everything a plugin author writes, and a plugin's only way to Tagma.
- [[c4451a7e]], the agent layer.

## Outcome

A person, or an agent working for them, extends Tagma through one thing: the plugin. A plugin may be any of these:
- a theme;
- a sidebar button;
- a section for a service;
- a separate tool, such as a language trainer;
- a launcher-style window over Tagma's agents;
- a model, harness or speech provider.

Size changes what a plugin declares, never what it is.

- A plugin in Tagma's format is written in TypeScript against `@runlith/tagma` and its `/plugin` door. An agent writes it, at a person's request: people using Tagma do not type commands or write code.
- Every plugin installs by one act from a folder, git, npm or a marketplace entry, and stands on the one Plugins screen.
- Claude Code and Codex plugins install through the same act and stand in the same list.
- An MCP server stays a connection, with its own list.

## Decided with the operator on 2026-11-05

- **One term.** The product says plugin. "App" leaves the product vocabulary; promotion may still use the word. "Tagma app" is never used: it names the client itself.
- **Tagma's format is the full one.** It carries everything the other formats carry and more, and readers translate the other formats into it without the person seeing them.
- **A bare MCP server is not a plugin.** It is a connection: a command or a URL with its secrets and sign-in, with no author, version or files. It keeps its own list. A plugin may bring servers into that list; they are marked with the plugin and switched with it.
- **Everything at the side is a plugin.** That includes model, harness and speech providers. A built-in one ships with Tagma as a plugin.
- **Every plugin in Tagma's format goes through the SDK.** The SDK is typed and public, and it is the plugin's only way to Tagma. Code in another language lives behind the plugin: in an MCP server it brings, or in a program its handlers run.
- **MCP is the wire** between Tagma and a plugin's process, and the SDK hides it.
- **Code first, then the manifest.** The author writes code. The SDK's build emits the manifest, which Tagma reads without running the plugin; nobody writes a manifest by hand.
- **All three depths on the agent layer are needed**, built in this order: a plugin's own chat over our agents, our thread inside a plugin, additions to our chat.
- **The Plugins screen stays the one home.** Apps get no screen of their own.
- **Built-in providers** stand on the Plugins screen in one group, "Built into Tagma". They cannot be removed, and they are switched off only for the whole machine.
- **A project declares the plugins it uses.** Beside its own `.tagma-plugins/<id>/`, a project lists plugins it uses from a marketplace, npm or git, with their version ranges, in the committed `.tagma-plugins/plugins.json`. Tagma writes that file when the person adds a plugin to the project from its card; nobody edits it by hand. A collaborator opening the project is offered each listed plugin they do not have.
- **A plugin's threads stand under the plugin.** The plugin decides whether they also stand in the general thread list.
- **A plugin may ask a model once, with no thread.**
- **Views are Svelte, plus HTML pages in a frame.** Views in React or other frameworks are left out for now. Adding them later is pure addition and breaks nothing, while adding them now would fix a second form of the view interface into the public contract.
- **The `TagmaApp` naming exception goes with `TagmaApp`.** The change that renames the code removes it from rules eeaf88ec and 931cfbf1.
- **The package keeps its name.** It stays `@runlith/tagma`, the package every project's `tagma.config.ts` already imports (`@runlith/tagma/rules`), with doors added. No separate generator package is published, because a plugin is started by an agent, never typed by a person.

Trust and consent at install are not part of this spec.

## Terms

- **Format** names what a plugin is written in: Tagma's format, Claude Code's or Codex's. Each is called by its name, never "native" or "foreign".
- **Source** names where a plugin came from: a marketplace, npm, git, a folder, or the project itself.
- **Connection** is an MCP server.
- **View kinds**, by how the window draws them:
  - a *Svelte view*, compiled by Tagma;
  - a *page view*, an HTML page the plugin brings, drawn in an iframe.
- **Tagma's own loop** is the agent loop Tagma runs: Tagma's own threads, and Tagma's agent hosted by an outside runner.

## What stands

| Act | Owner | What it takes | How it runs |
|---|---|---|---|
| `install_app`, `enable_app`, `uninstall_app` | `tagma-apps`, `views`, client `app-tagma-apps`, `app-views` | A directory holding a hand-written `tagma-app.json` | One MCP stdio process per machine. It is enabled per project, and a machine flag stops it everywhere (explanation 464327ae). Its contributions register from the live process's `tools/list` (explanation 38074044). Views are page views on the app's own origin (explanation a9714f0d). |
| `install_plugin`, `enable_plugin`; `update_plugin` belongs to `marketplaces` | `plugins`, `plugin-formats/*`, `marketplaces`, client `app-plugins` | Claude Code, Codex and Agent Plugins packages | Skills, commands, agents, MCP servers and command hooks, the hooks through the `plugin-hooks` rule. A person's layer ("all my projects") applies per project, and each project can switch a plugin off. |
| `install_adapter` and its family | `providers/adapters` | Model and harness adapters from npm, GitHub or a folder | Inside the server process: `importAdapter`, host modules, one directory per version with run leases (explanation 6cdd67c3) |
| `add_mcp_server` | `mcp` | Connections | The project's MCP pool |
| none | `composition/speech.ts` | Speech providers | A fixed list, compiled in |

The core under this is sound. Contribution points are declared by their owners (`ContributionPoint`, explanation 7d2dc40e), and every operation carries its schemas. What is missing:
- an SDK, a generator and a typed client;
- contributions that stand without a live process;
- loading window code from outside the build;
- a theme point, shortcuts and window kinds for plugins;
- one loader for in-server provider code;
- a plugin's way to call the servers it brought.

## The plugin

**Package.** A plugin in Tagma's format is a directory holding the SDK's build output:
- `tagma-plugin.json`;
- `dist/process.js`, when the plugin has a process;
- `dist/provider.js`, when it has a provider part;
- `dist/ui/`, which holds Svelte sources, the plain chunks they import, and page views.

The output is committed with the plugin's sources. A collaborator, or an install from git, therefore runs nothing before Tagma reads it.

**Manifest.**
- **Envelope.** `id`, `title`, `version` and `engines.tagma`. `engines.tagma` names the SDK surface version the plugin was built against: [[5067fa15]], Versions.
- **Process.** `process` holds `{entry, resident?}`.
- **Contributions by point.** `contributes` holds each point's entries, and each tool carries its description, input JSON Schema and annotations.

Tagma's format is the superset that the translation into it needs. Each part is a point of its owner:
- `skills` and `commands`;
- `mcpServers`, through `mcp`'s port for contributors;
- `options` and `secrets`;
- `agents` and `tools`;
- `views`, `sections`, `panes`, `windows`, `launchers`, `results`, `pins` and `shortcuts`;
- `themes`;
- `schedules`, `notifications`, `onThreadEnded`, `beforeBuild` and `hooks`;
- `resources`;
- `providers`.

The manifest's JSON Schema stays generated from the declared points. Every point's schema sits in its owner's `contract/wire`, including the points the window owns, and is listed in its owner's manifest.

**Where each part runs.**

| Part | Runs | Reason |
|---|---|---|
| Theme, shortcut, window entry, skill, command, option | Data in the manifest | No code needs to run |
| Sections, panes, windows, slots in the chat, composer and sidebar | A module mounted in the window | Keys, menus, drag and Tagma's components work only in the window's document |
| Tools, agents' tools, schedules, notifications, thread endings, build steps, hooks, resources | The plugin's process | Any language behind it, and a crash leaves the server standing |
| Model, harness and speech providers | Inside the server | Provider contracts share `effect`, `Held` and schema objects with the server (explanation 6cdd67c3) |

The graph, threads, law and gates are never plugins: the product's guarantees stand on them.

**Scope.** Enabling works as it does for agent plugins today: one project, or all of the person's projects with per-project switch-offs. "Off everywhere" disables the plugin for the whole machine.

| Contributions | Scope | Off here | Off everywhere | Remove |
|---|---|---|---|---|
| Tools, agents, skills, commands, MCP servers, sections, panes, results, pins, chat slots, hooks, `beforeBuild` | The project | Withdrawn from this project | Withdrawn everywhere | Withdrawn |
| Themes, shortcuts, windows | The person, in every window | No change | Withdrawn | Withdrawn |
| Process, schedules, endings, notifications | The machine | No change, since other projects still use them | The process stops and ticks stop | The process stops, the data stays |
| Providers | The machine | — | Withdrawn from the catalogs | Withdrawn; a built-in provider cannot be removed |

- **Handlers outside a project.** A tick and a global window have no project of their own. A handler there gets the projects where the plugin is enabled, and acts in one by naming it.
- **Global shortcuts.** A window opened by a global shortcut stands in the project of the last focused Tagma window.
- **Removing.** Removing a plugin keeps its data, and its card says so; a separate act deletes the data. Its pins stay, drawn as a gone view. Threads bound to it, and threads typed as one of its agents, stay as ordinary threads.

**Process life.** Contributions are published from the manifest when the plugin is enabled, with or without a running process; a process generation only executes them. The supervisor gains an `idle` state:
- A call, a tick, an ending owed, a view's subscription or a matching hook opens a generation under the plugin's lock.
- Idle stop, after a quiet period with no open subscription, runs the same six-step transition as a restart (explanation 38074044).
- A plugin marked `resident` stays up, because it holds a live connection to a service.
- A process whose `tools/list` differs from the manifest is refused, with the difference named.
- Plugins still on a hand-written `tagma-app.json` keep eager start until they move.

**Revision.** For a plugin built by the SDK, the process revision is the hash of the manifest and `process.entry`. Views are keyed apart from it, so a source edit followed by a rebuild restarts the process once and recompiles only what changed.

**Installed files.** Every plugin revision is installed into its own directory. A sweep honours the leases of every holder: process generations, provider runs and compiled views. The order of an install is:

fetch → read → check against the points → compile views → settle the directory → write the record.

At start the record and the directories are reconciled. A plugin installed from a folder runs its process and views in place, and its provider part is copied per revision, because ESM never unloads. The start step in `tagma-apps/steps/data.ts`, which moves `<data>/plugins/` and `plugin-data/` into `apps/`, retires in the same change.

**Formats.** Each `plugin-formats/<format>` reads a directory into one plugin description. `plugin-formats/tagma` reads `tagma-plugin.json`, and during the migration `tagma-app.json`. A directory that carries manifests for several clients, as the plugins of Tagma's marketplace already do, is read in Tagma's format when that manifest is present. Since Tagma's format is the superset, nothing is lost by reading it. Other formats keep:
- their `<plugin>-<name>` component names and collision rules;
- the list of what Tagma skips;
- their command hooks.

**MCP servers.** Declarations, the pool, sign-in and secrets stay with `mcp`. A plugin's servers reach the pool through `mcp`'s port for contributors. The plugin's process and its views call the tools of the servers it brought through the host, under that server's sign-in (`ctx.servers`). A service section therefore needs no second credential. A server's MCP App window keeps its two-layer iframe proxy (explanation 960e5e20), drawn by a module the MCP client owns.

## Interface

**Svelte views.**
- **Build.** The SDK build ships `.svelte` and `.svelte.ts` files as source. It bundles every other import of the views (the plugin's own TypeScript, npm packages) into plain ESM chunks that do not depend on Svelte's version, and rewrites the Svelte files' imports to point at those chunks.
- **Compile.** Tagma compiles only the Svelte files, with its own `compile` and `compileModule` and Bun's transpiler for TypeScript. It does this in a worker (rule 7a910861), at install and whenever the compiler's identity changes. The compile cache is keyed on that identity. Tagma promises Svelte's version 5 source language, never its internals.
- **Failure.** A view the compiler rejects refuses that view only, with the compiler's message; the plugin's tools and schedules stay.
- **Serving.** The output is served under `/api/plugins/<id>/`, behind admission on the remote door (explanation 8c5b6812).

**Host modules.** These modules are shared with the window, because they hold shared runtime state:
- `svelte`, `svelte/internal/client`, `svelte/internal/disclose-version` and `svelte/internal/flags/*`;
- `svelte/store`, `transition`, `motion`, `reactivity`, `events`, `attachments` and `animate`;
- the window's implementation of `@runlith/tagma/ui`.

The window's build emits each as a chunk with its named exports kept (`preserveSignature: 'strict'`), and the app imports those same chunks. Because Tagma compiles every plugin itself, it rewrites bare specifiers to the chunk URLs from the build manifest. No import map is needed, and the dev front's second origin is covered too. The published `@runlith/tagma/ui` is a type facade generated from the app's exports. A real implementation in a package would carry a second `@runlith/layer` and make a package depend on the app.

**Tailwind.** Tailwind does not run per plugin. Tagma regenerates one utilities sheet against the window's theme, over the window build's own class candidates and those of every enabled plugin, and swaps the sheet when a plugin is installed or removed. Utilities therefore keep one order, and a plugin cannot override the window's own classes.

**Page views.** An HTML page a plugin brings is drawn by an iframe module the host supplies, on the plugin's own origin, as views are today (explanation a9714f0d). This is what keeps the views of existing apps working, and it serves any finished web application a plugin brings whole.

**Placement.**
- Slots inside the chat, composer and feed take Svelte views only.
- A slot's owner shows a plugin's part only in threads of projects where the plugin is enabled.
- A part's module is loaded when the plugin is enabled, because feed rows need their geometry synchronously (explanation 8b7128c3).
- Every mount sits in its own `<svelte:boundary>`, so a throwing part breaks only itself.
- Sections, panes and windows take a Svelte view or a page view.
- The plugin template produces Svelte views, and agents write Svelte views by default.

**Where an iframe stays.** It stays where the HTML is not ours:
- an MCP App window;
- someone else's site or widget;
- a page view;
- the pages an agent writes, which keep their own origin.

**Windows and shortcuts.** Any window Tagma opens loads Tagma's client, so a plugin's window shows real threads as the main window does.
- **Window entries.** A plugin declares windows: plain, without a frame, or always on top. On the web, where there is no shell, they open as floating panels.
- **Shortcut entries.** A plugin declares shortcuts that open a view or run a command its process serves, local or global.
- **The shell grants them.** It already holds frameless, always-on-top windows and global shortcuts for its own dictation pill and quick hide (`apps/tagma/desktop/src/main.ts`, `projectWindows.ts`). It grants the declared entries, never Electron itself.
- **Conflicts.** A shortcut is a proposal, and the keymap owner resolves it (`app/src/lib/features/executions/terminal/Keymap.ts`). Tagma's own keys win, a second claim on a chord is refused and named on the plugin's card, and the person rebinds a plugin's keys in the keymap settings.

**Themes.**
- **Contents.** A `themes` entry carries token values for light and dark: surfaces, text, brand, syntax roles and the terminal palette.
- **The `Theme` service.** It holds a theme catalog: light, dark, and the themes of enabled plugins. It applies the chosen one. Today it only switches light and dark.
- **The terminal.** Its catalog takes the theme's terminal palette as hex, as Tagma's own themes keep theirs (note 1ec33fbf).
- **State colours** keep their meaning: a theme retunes their values, never swaps one for another.

## Modules after the change

- **`plugins` (server)** owns:
  - the manifest and the point registry: it checks contributions when a package is prepared, and publishes them when the plugin is enabled;
  - the one install act for every format, the machine record and the person's and project's enabling;
  - installed directories with their leases, and each plugin's data directory.

  `install_app`, `enable_app`, `uninstall_app`, `read_apps` and `read_app_schema` fold into its acts and reads, and adapter fetching and records fold in with them. "Enabled in this project" at admission is an `invocation` port that `plugins` fills.
- **`plugin-host` (server), today `tagma-apps`,** keeps process life only: the supervisor, its generations and `idle`, restart and backoff, and the `caller` a contribution carries for executing it. It imports `plugins`, never the other way.
- **One in-server loader** is extracted from `providers/adapters` (`importAdapter`, host modules, versioned directories, leases, sweep). `providers` and `speech` both load through it and each declares its own port for installed packages. Speech becomes a reloadable catalog, and a listening session pins the catalog it started with.
- **`views` (server) and `app-views` (client)** become the window's module host: the compile pipeline, the specifier rewrite, the utilities sheet, the module route, the slot faces, and the page-view iframe module. Each declares its port to `plugins` for installed packages.
- **`app-plugins` (client)** draws the screen. Providers are added from the Providers screen through the same install act.
- **`@runlith/tagma`** gains the `/plugin`, `/ui` and `/testing` doors beside `/rules` and `/adapter/*`, and the plugin template ([[5067fa15]]). `plugins` gains `create_plugin`, which writes the template into `.tagma-plugins/<id>/`.

## The Plugins screen

- **The project list** holds two groups: plugins, and MCP servers. A server a plugin brought is marked with that plugin.
- **Plugins built in the project** stand with the project as their source. One not yet installed on this machine has a row with Install.
- **Sources are the marketplaces.** Tagma's marketplace also carries plugins in Tagma's format. Claude Code and Codex plugins are translated, and what Tagma skips is named.
- **The add field** reads what an address holds: a package carrying `tagma-plugin.json`, or a Claude Code or Codex manifest, is a plugin; a command or a URL is a server.
- **A plugin's card speaks to a person who does not read code.**
  - It names in plain words what the plugin brings: tools for agents, skills, agents, a section or window, a theme, a provider.
  - Its state is a plain word: working, asleep or broken. Asleep is rest, not a fault.
  - Anything wrong shows as one sentence with **Fix with an agent**: a broken plugin, a view that did not compile, an outdated plugin, a shortcut already taken. The act opens a thread that holds the details — the end of stderr, the restart count, the versions, the compiler's message — so the person never reads them.
  - It says the plugin's data stays on remove.
  - **Add to this project** writes the plugin into `.tagma-plugins/plugins.json`.
- **The main act** follows what the plugin is: Try for a skill, Use for a theme, Open for a section or window.
- **The header** speaks of the window as well as of agents.

## Capabilities only a plugin reaches

`schedule`, `notify`, `on.ended` and `beforeBuild` stay plugin points, as typed fields in the SDK. Their engines are generic: `schedule`, for one, keys its grids by owner and delivers ticks through the `TickReceivers` port, which only `composition/ticks.ts` fills today. Giving a thread a timed assignment without a plugin is idea [[d5c27a25]], outside this spec.

## Migration

**Each start sub-step** is idempotent, verifies its target before it removes the source (as `secrets()` in `tagma-apps/steps/data.ts` does), and writes the records last.
- **Records.** `apps.installed` and `apps.enabled` map to plugin records:
  - an app enabled in a set of projects becomes enabled in those projects;
  - the machine-wide `enabled: false` becomes off everywhere;
  - an id that stands both as an app and as a plugin stops that app's migration, and its row names the collision.
- **Adapter records** move to plugin records.
- **Data.** `app-data/<id>` and `agent-plugin-data/` keep their place, so no data moves.
- **Secrets.** Values under owner `tagma-apps` move to the plugin owner. Settings → Apps → Secrets moves onto the plugin's card.
- **Schedules.** Grids keyed `app:<id>` move to the new owner with no period shift.

**Stored identifiers.** A third form step renames, in threads, settings and agent definitions:
- tool names `app__<id>__<tool>` to `plugin__<id>__<tool>`;
- `bindings.app` to `bindings.plugin`;
- the `apps` and `app:<id>` capabilities, and the `app__…` allowlists;
- the `agent.approves` lists.

Earlier steps renamed these identifiers from `plugin__` to `app__` (`tagma-apps/steps/toolNames.ts`, `threads/steps/appBinding.ts`, `native-harness/steps/appCapabilities.ts`). The new step reverses them the same way, so approvals and the endings of bound threads keep matching.

**Agents.** Agents in Tagma's format keep `<plugin>.<agent>`, and agents in the Claude Code and Codex formats keep `<plugin>-<agent>`. Each format keeps its own birth mode (explanations 871ec3c6, fe6dbfb8).

**Directories.**
- `.tagma-apps/<id>/` becomes `.tagma-plugins/<id>/`.
- The personal `apps/<id>/` in the data directory becomes `plugins/<id>/` there.
- Existing app directories keep working through the `tagma` reader and their page views until their owners rebuild them on the SDK. `tagma-app.json` is then read no longer.

**Text that follows.**
- The system prompt's Apps section (`tagma-apps/doctrine/apps.ts`) and the `apps` skill become a `plugins` section and skill that describe the SDK. Rule 7cb3c1cf follows them.
- Rules eeaf88ec and 931cfbf1 lose their `TagmaApp` exception in the change that renames the code.
- These blocks are rewritten when the code lands: [[b540be67]], [[15a61526]], a9714f0d, 12e4c3cd, 871ec3c6, 464327ae and 38074044.

`@runlith/tagma/rules` is unchanged, so every project's `tagma.config.ts` keeps working.

## Order of work

1. **Fold apps into `plugins` and its screen.** One install act, the records, the migration, and apps standing on the Plugins screen with their state. Today a failed app shows only in `read_apps` (feature 15a61526).
2. **The SDK and `create_plugin`, the SDK as a prerelease on npm.** Contributions published from the manifest, idle and on-demand start, committed build output.
3. **Themes, shortcuts and window entries**, as data or as a command the process serves.
4. **Depth 1 of the agent layer** (child spec).
5. **The window's module host:** Svelte views, page views, the utilities sheet. MCP App windows move to the MCP client's module.
6. **Depth 2** (child spec).
7. **Depth 3** (child spec).
8. **Providers through the one loader**, speech included.
9. **The SDK's stable release**, and Tagma's marketplace carrying plugins in Tagma's format.

## Acceptance

Performer checks, each through the same door a real caller uses:
- **A person asks in words.** A person tells an agent "make me a section for GitLab merge requests". The agent creates, builds, installs and enables the plugin, and the section opens. "Change X" makes the agent edit the plugin, and the section shows the change. The person types no command and reads no code.
- **Authoring.** An agent asked for a plugin calls `create_plugin`, then adds a tool, a schedule, a notification and a Svelte section; the build emits `tagma-plugin.json`. One `install_plugin` from the folder installs it. The tool stands in an agent's catalog before the process ever ran, and the first call starts the process.
- **Idle and resident.** A plugin idle past its quiet period stops, and its next tick starts it again. A `resident` plugin stays up.
- **Installing.** Plugins in Tagma's format install from git, from npm and from a marketplace entry. A Claude Code plugin and a Codex plugin install through the same act and are listed beside it, with their source and skipped parts. A plugin's MCP server stands in the server list marked with it.
- **The plugin's own server.** A plugin's process calls a tool of the server it brought under that server's sign-in, with no secret of its own.
- **Enabling.** Enable in one project, enable in all projects, switch off here, switch off everywhere and remove each have the effects of the scope table. Removing keeps the data; the separate act deletes it.
- **Updating.** An update installs a new revision while a run still holds the old provider code.
- **A collaborator.** A collaborator opening a project with a committed `.tagma-plugins/<id>/` is offered the plugin, and it runs with no build on their machine. A plugin the project lists in `.tagma-plugins/plugins.json` from a marketplace, npm or git is offered too, within its version range.
- **Existing apps.** Every existing app directory installs and runs through `install_plugin`. Its page views draw, and its data, secrets, schedule grid, bound threads and approvals stay intact.
- **Svelte views.** A Svelte section imports a Tagma component and renders with the window's tokens. A change of the compiler's identity recompiles it, counted through the compile cache.
- **Themes.** A theme changes surfaces, text, syntax and the terminal palette in both modes, and keeps the state colours' meanings.
- **Windows and shortcuts.** A shortcut on a chord the keymap leaves free opens a frameless, always-on-top window holding a grid of four threads on four providers. A plugin claiming a chord Tagma uses is refused, and its card names the chord.
- **Providers.** A model provider and a speech provider install as plugins with no rebuild and appear in their catalogs.
- **The screen.** A broken plugin shows one plain sentence and Fix with an agent. The thread that act opens holds the stderr and the versions.

## Open for the operator

- **Publishing.** Publishing `@runlith/tagma` on npm is an act outside the machine.

## Risks

- **A public contract.** The SDK surface, the host protocol, the slot faces and the host modules become a versioned contract. That goes against the practice of one form changed in one commit; only the surface the SDK lists is promised.
- **Svelte majors.** A new Svelte major recompiles every Svelte view and may refuse some.
- **A shared window.** A hung Svelte module hangs the window, and a leak lives until reload. The Vigla idea [[6b792682]] would address this later, and nothing here waits for it.
- **Weight.** The server ships the Svelte compiler and Tailwind on every platform, and regenerates one sheet on every install and every removal.

## Not established

- That the window's Vite build emits the host modules with their signatures kept, and imports them itself. This is reasoned from Rollup's `emitFile`, and not run.
- The cost of compiling one plugin, and of regenerating the utilities sheet.
- Whether Electron shortcuts reach the window while focus is inside an iframe, and whether the window survives a hung iframe.
- The memory a plugin process holds at rest.

These points are settled by the review: the desktop window loads the local door's origin (`desktop/src/config.ts`); the stdio spawn hands a plugin an allowlist of variables, never the server's environment (`packages/mcp/src/McpSession.ts`); child processes already run on `process.execPath`.
