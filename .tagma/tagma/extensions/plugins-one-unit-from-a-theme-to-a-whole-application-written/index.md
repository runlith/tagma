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
Read from the code at `11f23bfc7` on 2026-11-05, revised after two rounds of a product review and an architecture review the same day. Nothing was run.

Two child specs carry the detail:
- [[5067fa15]], the SDK: everything a plugin author writes, and a plugin's only way to Tagma.
- [[c4451a7e]], the agent layer.

## Outcome

A person extends Tagma through one thing, the plugin. An agent builds it at the person's request, because the people who use Tagma do not type commands or write code (rule bb5ca896). A plugin may be:
- a theme;
- a sidebar button;
- a section for a service;
- a separate tool, such as a language trainer;
- a launcher-style window over Tagma's agents;
- a model, harness or speech provider.

Size changes what a plugin declares, never what it is.

- A plugin in Tagma's format is written in TypeScript against `@runlith/tagma` and its `/plugin` door.
- Every plugin installs by one act from a folder, git, npm or a marketplace entry, and stands on the one Plugins screen.
- Claude Code and Codex plugins install through the same act and stand in the same list.
- An MCP server stays a connection, with its own list.

## Decided with the operator on 2026-11-05

- **One term.** The product says plugin. "App" leaves the product vocabulary; promotion may still use the word. "Tagma app" is never used: it names the client itself.
- **Tagma's format is the full one.** It carries everything the other formats carry, and more. Readers translate the other formats into it without the person seeing them.
- **A bare MCP server is not a plugin.** It is a connection: a command or a URL with its secrets and sign-in, and no author, version or files. It keeps its own list. A plugin may bring servers into that list; they are marked with the plugin and switched with it.
- **Everything at the side is a plugin**, model, harness and speech providers included. A built-in one ships with Tagma as a plugin.
- **Every plugin in Tagma's format goes through the SDK.** The SDK is typed and public, and it is the plugin's only way to Tagma. Code in another language lives behind the plugin, in an MCP server it brings or in a program its handlers run.
- **MCP is the wire** between Tagma and a plugin's process. The SDK hides it.
- **Code first, then the manifest.** The author writes code. The SDK's build emits the manifest, which Tagma reads without running the plugin. Nobody writes a manifest by hand.
- **All three depths on the agent layer are needed.** They are built in this order: a plugin's own chat over our agents, our thread inside a plugin, additions to our chat.
- **The Plugins screen stays the one home.** Apps get no screen of their own.
- **Built-in providers** stand on the Plugins screen in one group, "Built into Tagma". They cannot be removed, and they are switched off only for the whole machine.
- **A project declares the plugins it uses** in the committed `.tagma-plugins/plugins.json`. Tagma writes the file; nobody edits it by hand. A collaborator opening the project is offered each listed plugin they do not have.
- **A plugin's threads stand under the plugin.** The plugin decides whether they also stand in the general thread list.
- **A plugin may ask a model once, with no thread.**
- **Views are Svelte.** Views in React or other frameworks are left out for now. Adding them later is pure addition and breaks nothing. Adding them now would fix a second form of the view interface into the public contract. Someone else's HTML stands in a frame inside a Svelte view.
- **No compatibility with old forms** (rule [[0528876d]]). Apps, `tagma-app.json`, `.tagma-apps` and their records go outright, and nothing old is read beside the new.
- **The `TagmaApp` naming exception goes with `TagmaApp`.** The change that renames the code removes it from rules eeaf88ec and 931cfbf1.
- **The package keeps its name.** It stays `@runlith/tagma`, the package every project's `tagma.config.ts` already imports (`@runlith/tagma/rules`), with doors added. No separate generator package is published.

Trust and consent at install are not part of this spec.

## Terms

- **Format** names what a plugin is written in: Tagma's format, Claude Code's or Codex's. Each is called by its name, never "native" or "foreign".
- **Source** names where a plugin came from: a marketplace, npm, git, a folder, or the project itself.
- **Connection** is what an MCP server is. The screen calls these "MCP servers".
- **View** is a Svelte view, compiled by Tagma.
- **Prompt command** is a slash command in the composer: text from the plugin, or a handler in its process. **Action** is what a shortcut or the palette runs: one of Tagma's, or a plugin's — something its process serves, or opening its section or pane.
- **Tagma's own loop** is the agent loop Tagma runs: Tagma's own threads, and Tagma's agent hosted by an outside runner.

## What stands

| Act | Owner | What it takes | How it runs |
|---|---|---|---|
| `install_app`, `enable_app`, `uninstall_app` | `tagma-apps`, `views`, client `app-tagma-apps`, `app-views` | A directory holding a hand-written `tagma-app.json` | One MCP stdio process per machine, enabled per project. A machine flag stops it everywhere (explanation 464327ae). Its contributions register from the live process's `tools/list` (explanation 38074044). Views are HTML pages framed on the app's own origin (explanation a9714f0d). |
| `install_plugin`, `enable_plugin`; `update_plugin` belongs to `marketplaces` | `plugins`, `plugin-formats/*`, `marketplaces`, client `app-plugins` | Claude Code, Codex and Agent Plugins packages | Skills, commands, agents, MCP servers and command hooks, the hooks through the `plugin-hooks` rule. A person's layer ("all my projects") applies per project, and each project can switch a plugin off. |
| `install_adapter` and its family | `providers/adapters` | Model and harness adapters from npm, GitHub or a folder | Inside the server process: `importAdapter`, host modules, one directory per version, run leases (explanation 6cdd67c3) |
| `add_mcp_server` | `mcp` | Connections | The project's MCP pool |
| none | `composition/speech.ts` | Speech providers | A fixed list, compiled in |

The core under these is sound. Contribution points are declared by their owners (`ContributionPoint`, explanation 7d2dc40e), and every operation carries its schemas. What is missing:
- an SDK and a typed client;
- contributions that stand without a live process;
- loading window code from outside the build;
- a theme point, shortcuts and window kinds for plugins;
- one loader for in-server provider code;
- a plugin's way to call the servers it brought.

## The plugin

**Package.** A plugin in Tagma's format is a directory. It holds its sources, its own `package.json` with `@runlith/tagma` and its other dependencies, and the SDK's build output:
- `tagma-plugin.json`;
- `dist/process.js`, when the plugin has a process;
- `dist/provider.js`, when it has a provider part;
- `dist/ui/`, holding Svelte sources and the plain chunks they import.

The build output is committed. A collaborator, or an install from git, therefore needs nothing installed and runs nothing before Tagma reads the plugin. The scaffold marks `dist/**` and `tagma-plugin.json` as generated, merged as binary, in `.gitattributes`. Tagma's commit steps (format commands, inspections, the commit door) skip `.tagma-plugins/*/dist/` and the manifest. The manifest records a hash of the sources it was built from. When the sources move past it, the card reads "outdated", and Fix with an agent rebuilds the plugin.

**Manifest.**
- **Envelope.** `id`, `title` and `version`. There is no version gate against Tagma ([[5067fa15]], Versions).
- **Process.** `process` holds `{entry, resident?}`.
- **Contributions by point.** `contributes` holds each point's entries. Each tool carries its description, input JSON Schema and annotations.

Tagma's format is the superset that translation into it needs. Each part is a point of its owner:
- `skills` and `commands`;
- `mcpServers`, through `mcp`'s port for contributors;
- `options` and `secrets`;
- `agents` and `tools`;
- `views`, `sections`, `panes`, `windows`, `launchers`, `results`, `pins`, `shortcuts` and `actions`, whose schemas `views` owns;
- `themes`, whose schema and meaning check `appearance` owns ([[ca575591]]);
- `schedules`, `notifications`, `onThreadEnded`, `onThreadAsked`, `beforeBuild` and `hooks`;
- `resources`;
- `providers`.

The SDK's field types and its build check stay generated from the declared points. Every point's face — its schema and its checks against the other points — sits in its owner's `contract/wire` and is listed in its owner's manifest.

**Where each part runs.**

| Part | Runs | Reason |
|---|---|---|
| Theme, shortcut, window entry, skill, prompt command as text, option | Data in the manifest | No code needs to run |
| Sections, panes, windows, slots in the chat, composer and sidebar | A module mounted in the window | Keys, menus, drag and Tagma's components work only in the window's document |
| Tools, actions, schedules, notifications, thread endings, questions, build steps, hooks, resources | The plugin's process | Any language behind it, and a crash leaves the server standing |
| Model, harness and speech providers | Inside the server | Provider contracts share `effect`, `Held` and schema objects with the server (explanation 6cdd67c3) |

The graph, threads, law and gates are never plugins: the product's guarantees stand on them.

**Scope.** Enabling works as it does for agent plugins today: in one project, or in all of the person's projects with switch-offs per project.

| Contributions | Scope | Off here | Off everywhere | Remove |
|---|---|---|---|---|
| Tools, agents, skills, commands, MCP servers, sections, panes, results, pins, chat slots, hooks, `beforeBuild` | The project | Withdrawn from this project | Withdrawn | Withdrawn |
| Themes, shortcuts, windows | The person, in every window | No change | Withdrawn | Withdrawn |
| Process, schedules, endings, questions, notifications | The machine, while the plugin is enabled in at least one project | Stops when no project is left | The process and its ticks stop | The process stops; the data stays |
| Providers | The machine | — | Withdrawn from the catalogs | Withdrawn; a built-in provider cannot be removed |

- **Outside a project.** A tick has no project of its own. Its handler gets the projects where the plugin is enabled, and acts in one by naming it.
- **Windows without a project.** A window the person opens with a global shortcut stands where a shortcut press acts ([[ba083eb0]]): the context project, or else the first project of the person's list where the plugin is enabled. It asks nothing.
- **"Stop in all my projects"** drops the person's layer. **"Turn off everywhere"** disables the plugin for the machine. The card uses these two phrases and does not mix them.
- **Themes** stay offered while the plugin is on in any project or for all my projects, so "off here" changes nothing while it is on elsewhere. **Use** turns a theme's plugin on for all my projects, when it is on nowhere, and chooses the theme in the same act ([[ca575591]]).
- **Removing** keeps the plugin's data, and the card says so; a separate act deletes the data. Its pins stay, drawn as a gone view. Threads bound to it, and threads typed as one of its agents, stay as ordinary threads.

**Process life.** Contributions are published from the manifest while the plugin is enabled, with or without a running process. A process generation only executes them, and a broken plugin's tools are withdrawn from agents' catalogs while it stays broken. The supervisor gains an `idle` state:
- **Demands.** A call, a tick, an owed ending or question, a view's subscription, or a matching hook opens a generation under the plugin's lock.
- **Idle stop.** After a quiet period with none of these, the process stops through the same six-step transition as a restart (explanation 38074044).
- **A demand during idle stop** waits for the stop to finish, then opens a new generation.
- **A crash.** A plugin that is not resident goes to `idle` behind a backoff gate. A demand during backoff is deferred until the gate opens: a tick runs then, an ending or question is delivered then. A `resident` plugin restarts on its own, as apps do today.
- **`resident`** keeps a plugin up, for one that holds a live connection to a service.
- **A process whose `tools/list` differs from the manifest is refused**, with the difference named.

**Revision.** The process revision of an SDK-built plugin comes from the manifest and `process.entry`, judged by size and modification time, with content hashed in a worker. Views are keyed apart from it. A source edit followed by a rebuild therefore restarts the process once, and recompiles only the views that changed.

**Installed files.** `plugins` owns every installed directory, the leases on it, and the sweep. Each plugin revision is installed into `<data>/plugin-revisions/<id>/<revision>/`. Every holder registers its lease through a port of `plugins`: a process generation, a provider run, a compiled view. The sweep honours all of them. An install runs in this order:

fetch → read → check against the points → compile views → settle the directory → write the record.

At start, the records and the directories are reconciled. A plugin installed from a folder runs its process and views in place. Its provider part is copied per revision, because ESM never unloads. A person's own plugins live in `<data>/plugins/<id>/`.

**Formats.** Each `plugin-formats/<format>` reads a directory into one plugin description. `plugin-formats/tagma` reads `tagma-plugin.json`. A directory carrying manifests for several clients is read in Tagma's format when that manifest is present. Since Tagma's format is the superset, reading it loses nothing. The other formats keep:
- their `<plugin>-<name>` component names and collision rules;
- the list of what Tagma skips;
- their command hooks.

**MCP servers.** Declarations, the pool, sign-in and secrets stay with `mcp`. A plugin's servers reach the pool through `mcp`'s port for contributors. The plugin's process and views call the tools of the servers it brought through the host, under that server's sign-in, by an `external` operation of `mcp`, `call_contributed_tool`. A service section therefore needs no second credential. A server's MCP App window keeps its two-layer iframe proxy (explanation 960e5e20), drawn by a module the MCP client owns.

**Updates.** `plugins` checks every source for a newer version within the range the project lists, or the latest when none is listed: a marketplace entry, npm, git. The card reads "update available" with **Update** in place.

## Interface

**Svelte views.**
- **Build.** The SDK build ships `.svelte` and `.svelte.ts` files as source, the plugin's and those of its dependencies alike. Every other import is bundled into plain ESM chunks. Host specifiers stay external in the chunks too. The graph runs one way: Svelte files import chunks, never the reverse. A dependency that imports `svelte/internal/*` fails the build.
- **Compile.** Tagma compiles only the Svelte files, with its own `compile` and `compileModule` and options matching the window's: runes, async and production. TypeScript goes through Bun's transpiler. The work runs in a worker (rule 7a910861).
- **Link.** The compiled output, and the chunks, have their host specifiers rewritten to the host modules' chunk URLs. The link is keyed on the window build's manifest hash, which covers the compiler's identity and every host chunk URL. Any Tagma update that changes either recompiles and relinks.
- **Failure.** A view the compiler rejects refuses that view only, with the compiler's message. The plugin's tools and schedules stay.
- **Serving.** Plugin modules are served under content-addressed URLs below `/api/plugins/<id>/`, behind admission on the remote door (explanation 8c5b6812). After an update, an open window unmounts the plugin's mounts and remounts them from the new URLs. The old module stays in memory until the window reloads.
- **Development.** The dev front reaches `/api/plugins/*` through its existing `/api` proxy. Rewriting host specifiers to the Vite optimizer's URLs in development is not established.

**Host modules.** These modules are shared with the window, because they hold shared runtime state:
- `svelte`, `svelte/internal/client`, `svelte/internal/disclose-version` and `svelte/internal/flags/*`;
- `svelte/store`, `transition`, `motion`, `reactivity`, `events`, `attachments` and `animate`;
- the window's implementation of `@runlith/tagma/ui`.

The window's build emits each as a chunk with its named exports kept (`preserveSignature: 'strict'`), and the app imports those same chunks. The published `@runlith/tagma/ui` is a type facade generated from the app's exports. A real implementation in a package would carry a second `@runlith/layer` and make a package depend on the app.

**Tailwind.** Tailwind does not run per plugin. In a worker, Tagma regenerates one utilities sheet over the window build's own class candidates and those of every enabled plugin, against the window's resolved `app.css` input. The window build ships that input as an artefact: the theme, the chat-ui theme, its variants and utilities. The sheet is swapped whenever the set of views changes: install, update, removal, enabling, or a view's rebuild. Utilities therefore keep one order, and a plugin cannot override the window's own classes.

**Someone else's HTML.** A Svelte view embeds a site, a widget or a whole web application with `<Frame src>` from `@runlith/tagma/ui`. That is an iframe on its own origin, and the framed page reaches no Tagma API.

**Placement.**
- Slots inside the chat, composer and feed take Svelte views only.
- A slot's owner shows a plugin's part only in threads of projects where the plugin is enabled.
- A part's module loads when the plugin is enabled, because feed rows need their geometry synchronously (explanation 8b7128c3).
- Every mount sits in its own `<svelte:boundary>`, so a throwing part breaks only itself.
- Sections, panes and windows take Svelte views.
- The plugin template produces Svelte views, and agents write Svelte views by default.

**Where an iframe stays.** It stays where the HTML is not ours:
- an MCP App window;
- someone else's site, widget or web application, through `<Frame>` inside a Svelte view;
- the pages an agent writes, which keep their own origin.

**Windows and shortcuts.** Any window Tagma opens loads Tagma's client, so a plugin's window shows real threads, as the main window does.
- **Window entries.** A plugin declares windows: plain, frameless, or always on top. On the web, where there is no shell, they open as floating panels.
- **Shortcut entries.** A plugin declares shortcuts that open one of its sections or panes, or run one of its actions, either local or global; a global one works in every app only once the person allows it on the plugin's card ([[ba083eb0]]).
- **The shell grants them.** It already holds frameless, always-on-top windows and global shortcuts for its own dictation pill and quick hide (`apps/tagma/desktop/src/main.ts`, `projectWindows.ts`). It grants the declared entries, never Electron itself.
- **Conflicts.** A shortcut is a proposal. One table over every action resolves it, in the window's keymap `app-keys`: the person's own keys win, then Tagma's, then plugins in install order. A proposal on a taken chord stays unbound and is named on the plugin's card, with **Rebind** in place; the plugin itself is never refused for it.

**Themes** ([[ca575591]]).
- **Contents.** A `themes` entry has a light variant, a dark one, or both. Each sets, by meaning, only the colours it changes — surfaces, text, signals, syntax roles, project and worktree marks, the terminal's ANSI colours — over Tagma's own values. Tagma derives the rest.
- **Tagma's own look** is the first theme, in the same format, and its stylesheet is generated from it.
- **The person's choice** is two `user`-scope settings, the theme and light or dark. Every window and device follows it live.
- **The terminal** defaults to "Same as the theme". Code colours follow from the syntax roles.
- **State colours** keep their meaning. A check in the point's face, run at build, install and read, refuses a theme that moves a signal out of its hue family or below contrast.

## Modules after the change

- **`plugins` (server)** owns:
  - the manifest and the point registry: it checks contributions when a package is prepared, and publishes them while the plugin is enabled;
  - the one install act for every format, updates for every source, the machine record, and the person's and the project's enabling;
  - installed directories, their leases and the sweep, and each plugin's data directory;
  - `create_plugin`, which writes the SDK's template into `.tagma-plugins/<id>/` for a project's plugin, or into `<data>/plugins/<id>/` for the person's own, such as a theme he asked for.

  Adapter fetching moves into it. Admission in `invocation` checks a plugin caller against the enabled set `plugins` owns, which it reads directly from above ([[c4451a7e]]).
- **`plugin-host` (server), today `tagma-apps`,** keeps process life only: the supervisor, its generations, `idle`, the backoff gate, and the `caller` each contribution carries for executing it, hooks included. It imports `plugins`, never the other way.
- **One in-server loader** is extracted from `providers/adapters`: `importAdapter`, host modules, run pinning. It imports from a directory `plugins` gives it, and registers its runs as holders through `plugins`' lease port. `providers` and `speech` both load through it, each declaring its own port for installed packages. Speech becomes a reloadable catalog, and a listening session pins the catalog it started with.
- **`views` (server) and `app-views` (client)** become the window's module host: the compile pipeline, the link step, the utilities sheet, the module route, the slot faces and `<Frame>`. `views` owns the schemas of every window point but `themes`.
- **`appearance` (server) and `app-appearance` (client)** own how Tagma looks: the `themes` point and its meaning check, Tagma's own theme as data, the person's theme settings, and painting every window ([[ca575591]]).
- **`app-plugins` (client)** draws the screen. The Providers screen adds providers through the same install act.
- **`app-keys` (client)** becomes the one keymap over every action, and a new client module draws the person's Shortcuts settings; plugins' actions and shortcuts are `views` points ([[ba083eb0]]).
- **`@runlith/tagma`** gains the `/plugin`, `/ui` and `/testing` doors beside `/rules` and `/adapter/*`, and the plugin template ([[5067fa15]]).

## The Plugins screen

- **The project list** holds three groups:
  - plugins;
  - MCP servers, each one a plugin brought marked with that plugin;
  - "Built into Tagma", for the built-in providers.
- **Plugins built in the project** stand with the project as their source. One not yet installed on this machine has a row with Install.
- **Sources are the marketplaces.** Tagma's marketplace also carries plugins in Tagma's format. Claude Code and Codex plugins are translated, and what Tagma skips is named.
- **The add field** reads what an address holds. A package carrying `tagma-plugin.json`, or a Claude Code or Codex manifest, is a plugin; a command or a URL is a server.
- **A plugin's card speaks to a person who does not read code.**
  - It names in plain words what the plugin brings: tools for agents, skills, agents, a section or window, a theme, a provider. A hook reads "checks Tagma's agent before it acts — not Claude Code or Codex".
  - Its state is one of four plain words: working, asleep, needs you, broken. Asleep is rest, not a fault. "Needs you" covers what only the person can do: a server's sign-in, a secret, a required option. The act stands in place: **Sign in** or **Set**. Agents never sign in for the person.
  - Wherever one click fixes something, that click stands in place: **Update**, **Rebind**.
  - Anything else wrong shows as one sentence with **Fix with an agent**: a broken process, a view that did not compile, an outdated build, a plugin the running Tagma no longer accepts. The act opens a thread holding the details, so the person never reads them: the end of stderr, the restart count, the versions, the compiler's message.
  - It shows what `ask_model` has spent.
  - It says the plugin's data stays on remove.
- **Adding a plugin to a project is one act.** **Add to this project** enables the plugin here and lists it in `.tagma-plugins/plugins.json` for collaborators. **Only for me** enables it without listing it. The change to the file stands in the project with its other changes and is committed with them.
- **The main act** follows what the plugin is: Try for a skill, Use for a theme (a theme applies in every window), Open for a section or window.
- **A plugin's threads** stand under its section or rail entry when it has one, otherwise on its card.
- **The header** speaks of the window as well as of agents.

## Capabilities only a plugin reaches

`schedule`, `notify`, `on.ended` and `beforeBuild` stay plugin points, as typed fields in the SDK. Their engines are generic. `schedule`, for one, keys its grids by owner and delivers through the `TickReceivers` port, which only `composition/ticks.ts` fills today. Giving a thread a timed assignment without a plugin is idea [[d5c27a25]], outside this spec.

## Removing apps

By rule [[0528876d]], nothing old is carried over or read beside the new.
- **The app mechanism is removed:** `install_app`, `enable_app`, `uninstall_app`, `read_apps` and `read_app_schema`; `tagma-app.json`, `.tagma-apps` and the personal `apps/`; the `apps.installed` and `apps.enabled` records; the `tagma-apps` secret owner; the start step `tagma-apps/steps/data.ts`; and the three journal form steps that renamed plugins to apps, since they run on every read and would turn the current names back into app names. The existing apps stop. Any worth keeping is rebuilt as a plugin on the SDK.
- **`install_adapter` and its records are removed.** Adapters that were installed are installed again as plugins.
- **Names change in place,** in code, agent definitions and settings: tool names become `plugin__<id>__<tool>`, the binding becomes `bindings.plugin`, and the capabilities become `plugins` and `plugin:<id>`. `agent.approves` entries naming app tools go with the apps. Thread records are not rewritten: tool names in old threads stay as they were written.
- **Agents.** Agents in Tagma's format are named `<plugin>.<agent>`, and agents in the Claude Code and Codex formats `<plugin>-<agent>`. Each format keeps its own birth mode (explanations 871ec3c6, fe6dbfb8).

**Text that follows.**
- The system prompt's Apps section (`tagma-apps/doctrine/apps.ts`) and the `apps` skill become a `plugins` section and a `plugins` skill that describe the SDK. Rule 7cb3c1cf follows them.
- Rules eeaf88ec and 931cfbf1 lose their `TagmaApp` exception in the change that renames the code.
- These blocks are rewritten when the code lands: [[b540be67]], [[15a61526]], a9714f0d, 12e4c3cd, 871ec3c6, 464327ae and 38074044.

`@runlith/tagma/rules` does not change, so every project's `tagma.config.ts` keeps working.

## Order of work

1. **Replace apps with plugins in `plugins` and its screen.** One install act for every format, process state on the screen, and the app mechanism removed. Any existing app worth keeping is rebuilt as a plugin in step 2.
2. **The SDK and `create_plugin`,** with the SDK as a prerelease on npm. Contributions published from the manifest, idle and on-demand start, committed build output.
3. **Themes and shortcuts**, as data or as an action the process serves. A shortcut opens a plugin's view where views already stand (a section, a pane) or runs an action; it opens no new window.
4. **Depth 1 of the agent layer** (child spec).
5. **The window's module host:** Svelte views, `<Frame>`, the link step, the utilities sheet. MCP App windows move to the MCP client's module.
6. **Depth 2** (child spec).
7. **Depth 3** (child spec).
8. **Providers through the one loader**, speech included.
9. **The SDK's stable release**, and Tagma's marketplace carrying plugins in Tagma's format.
10. **Window entries:** plain, frameless and always-on-top windows a plugin declares, the shell's grants for them, and their floating panels on the web. Plugins use no new windows before this step (operator's decision, 2026-11-06).

## Acceptance

Performer checks, each through the same door a real caller uses.

**Asking and authoring**
- **A person asks in words.** A person tells an agent "make me a section for GitLab merge requests". The agent creates the plugin, installs its dependencies, builds, installs and enables it, and the section opens. "Change X" makes the agent edit it, and the section shows the change. The person types no command and reads no code.
- **Authoring.** An agent calls `create_plugin`, installs the folder's dependencies, and adds a tool, a schedule, a notification and a Svelte section. The build type-checks and emits `tagma-plugin.json`. One `install_plugin` from the folder installs the plugin. The tool stands in an agent's catalog before the process has ever run, and the first call starts the process.

**Process life**
- **Idle and resident.** A plugin idle past its quiet period stops, and its next tick starts it again. A demand that arrives during idle stop is served by the next generation. A `resident` plugin stays up.
- **Running nowhere.** A plugin switched off in its only project stops its process and ticks.

**Installing and enabling**
- **Installing.** Plugins in Tagma's format install from git, from npm and from a marketplace entry. A Claude Code plugin and a Codex plugin install through the same act and are listed beside it, with their source and skipped parts. A plugin's MCP server stands in the server list, marked with the plugin.
- **The plugin's own server.** A plugin's process calls a tool of the server it brought, under that server's sign-in, with no secret of its own.
- **Enabling.** Each act has the effects of the scope table: Add to this project, Only for me, Stop in all my projects, Turn off everywhere, Remove. Add to this project writes `.tagma-plugins/plugins.json`. Remove keeps the data, and the separate act deletes it.
- **Updating.** An update installs a new revision while a run still holds the old provider code. An npm-sourced plugin with a newer version in range reads "update available". An open window remounts the plugin's views from the new revision.
- **A collaborator.** A collaborator opening a project with a committed `.tagma-plugins/<id>/` is offered the plugin, and it runs with no build on their machine. A plugin listed in `plugins.json` from a marketplace, npm or git is offered too, within its version range.
- **No app left.** `install_app` and `install_adapter` are gone, and Tagma reads no `tagma-app.json`. The operator's threads and graph open as before.

**What the person sees**
- **Svelte views.** A Svelte section imports a Tagma component and renders with the window's tokens. A change in the window build's manifest hash relinks it, as the link cache counts.
- **Themes.** A theme changes surfaces, text, syntax and the terminal palette in both modes, in every open window. One that moves a state colour out of its meaning fails its build and its install with the reason ([[ca575591]]).
- **Shortcuts.** A shortcut on a chord the keymap leaves free opens the plugin's section, in a project where the plugin is enabled. A plugin's shortcut on a chord Tagma uses stays unbound, and its card names the chord with Rebind.
- **Windows (step 10).** A shortcut opens a frameless, always-on-top window holding a grid of four threads on four providers.
- **Providers.** A model provider and a speech provider install as plugins with no rebuild and appear in their catalogs. A built-in provider stands under "Built into Tagma", cannot be removed, and turns off only for the machine.
- **The screen.**
  - A server waiting on a sign-in shows "needs you" with Sign in.
  - A broken plugin shows one plain sentence and Fix with an agent, whose thread holds the stderr and what the running Tagma refused.
  - The card shows the plugin's `ask_model` spending.
  - A plugin's threads stand under its section.

## Open for the operator

- **Publishing.** Publishing `@runlith/tagma` on npm is an act outside the machine.

## Risks

- **A public contract later.** While rule [[0528876d]] stands, the SDK changes with Tagma in one commit, and a plugin it breaks is rebuilt by an agent. When outside authors arrive and the rule is cancelled, the SDK surface, the host protocol, the slot faces and the host modules become a versioned contract.
- **Svelte majors.** A new Svelte major recompiles every Svelte view, and may refuse some.
- **A shared window.** A hung Svelte module hangs the window, and a leak lives until reload. The Vigla idea [[6b792682]] would address this later. Nothing here waits for it.
- **Weight.** The server ships the Svelte compiler and Tailwind on every platform, and regenerates one sheet whenever the set of views changes.

## Not established

- That the window's Vite build emits the host modules with their signatures kept, and imports them itself. This is reasoned from Rollup's `emitFile`, not run.
- Rewriting host specifiers in the dev front, against the Vite optimizer's URLs.
- The cost of compiling one plugin, and of regenerating the utilities sheet.
- Whether Electron shortcuts reach the window while focus is inside an iframe, and whether the window survives a hung iframe.
- The memory a plugin process holds at rest.

The reviews settled these: the desktop window loads the local door's origin (`desktop/src/config.ts`); the stdio spawn hands a plugin an allowlist of variables, never the server's environment (`packages/mcp/src/McpSession.ts`); child processes already run on `process.execPath`.
