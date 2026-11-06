---
id: 01a1b1a5-f0a8-701e-8971-9bf996ba6027
title: "The window's module host: plugin views compiled by Tagma, linked by the window's import map, styled by one utilities sheet"
ord: 7
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a1ad4a-de84-7ddc-9396-cf6ac4451a7e
  - kind: relates
    to: 01a1ad53-a8b9-7fa9-98a0-71655067fa15
  - kind: relates
    to: 01a1b123-680f-7ed0-9645-9d2cba083eb0
  - kind: relates
    to: 01a1b124-db79-7d5f-8149-70c5ca575591
sources:
  - kind: dir
    ref: apps/tagma/server/src/views
  - kind: dir
    ref: apps/tagma/app/src/lib/features/plugin-views
  - kind: dir
    ref: apps/tagma/app/src/lib/features/views
  - kind: file
    ref: apps/tagma/app/scripts/surfaceConfig.ts
  - kind: file
    ref: packages/tagma/src/plugin/build.ts
---
Child of [[d2b5f488]]; details its step 5. Read from the code at `18ca1b9a1` on 2026-11-06. The parent's open build questions were settled by experiments in a throwaway directory against the versions this repository installs: Vite 8.2.2 on Rolldown 1.2.7, SvelteKit 2.70.3, vite-plugin-svelte 7.3.0, Svelte 5.57.0, Tailwind 4.3.3, jsdom 29.1.1 and Bun 1.4.4. That directory was not kept; section Measured records what each run showed. No part of the product was run.

## Outcome

A plugin's section, pane, launcher window and tool card are Svelte components running in Tagma's own window, beside Tagma's own code. Inside them, Tagma's components, tokens, keys, menus, drag, focus and theme work as they do anywhere else in the window. A person sees one application, not pages stitched into it, and a plugin's section opens as fast as one of Tagma's own.

Tagma compiles every view itself. An update of Tagma, a new Svelte included, therefore keeps a plugin installed from npm or a marketplace working with no rebuild on the person's machine. Someone else's HTML still stands in a frame: a site a view embeds with `<Frame>`, and an MCP App window. A view that does not compile says so in one sentence where it stands and on its plugin's card, with **Fix with an agent**.

## Decisions

1. **The browser links, Tagma does not.** The window's shell carries one import map from each host specifier to a host module at a fixed path under `/_app/host/`. A compiled plugin module keeps `svelte/internal/client` and `@runlith/tagma/ui` as bare specifiers, and the browser resolves them to the window's own modules. The parent's link step is not built: no rewriting of specifiers to chunk URLs, no link cache keyed on the window build's manifest hash, no relinking after a Tagma update. A compiled module depends only on its sources and the compiler, so it survives every window build that keeps Svelte.
2. **A host module is a facade over the window's own chunks.** The window build emits each host module as a chunk with a fixed file name and `preserveSignature: 'strict'`. Rolldown makes it a re-export of the chunks the window itself imports, so a plugin and the window run one Svelte runtime (Measured, runs A and B).
3. **A plugin ships its resolved view graph, and Tagma bundles it.** The SDK build ships every file the views reach, with the resolution it made, as `dist/ui/`. Tagma bundles that graph with `Bun.build` and its own Svelte compiler, in a worker. It needs no `node_modules` and no resolver of its own (run F).
4. **One bundle per plugin revision.** All views of a plugin are bundled together with code splitting, so a store module that two views import is one instance. A compile failure therefore refuses all of the plugin's views, not one. The SDK build compiles the same graph first, so Tagma meets a failure mostly after a Svelte change.
5. **Views compile after publication, never at install.** `register` of the `views` point records the set and returns at once; the compile runs after it. A `register` that waited would hold the plugin's lock, and a failing `register` withdraws the plugin's whole publication, its tools included (`plugins/points.ts`, `publish`).
6. **One utilities sheet per machine.** The server regenerates one union of the window's utilities and every published plugin's, and the window appends it after its own sheet. In the dev front, Tailwind takes the plugins' candidates as `@source inline(...)` instead.
7. **A view talks to the window directly.** `useTagma()` answers a per-mount client built from window services. The `tagma/*` JSON-RPC bridge for plugin views goes, together with their origins and their frames.
8. **The MCP client's module draws MCP App windows.** `ViewFrame`, `ViewBridge`, `ResultFrame` and their helpers move into `app-mcp`. The generic `Frame` moves into `app-shared` and becomes the `<Frame>` of `/ui`. The `app-views` module ends.

## What a plugin ships: the view graph

`tagma-plugin build` writes `dist/ui/` beside `dist/process.js` ([[5067fa15]], What the build emits). It holds:
- **Files.** Every file `Bun.build` loads from the view entries, kept as written. The plugin's own `.svelte`, `.svelte.ts`, `.svelte.js`, `.ts` and `.js` files keep their paths from the plugin's root. Each dependency's files go under `_modules/<package>/<path>`. An image that a section or pane names as its icon is copied the same way.
- **`graph.json`.** For each file, every import specifier it writes and the file it resolved to, or `host` for a host specifier. It also carries `candidates`: the Tailwind class candidates of every shipped file, read by `@tailwindcss/oxide`'s scanner.

**How the SDK records it.** It runs the same bundling Tagma runs, with the SDK's own Svelte, node resolution and the conditions `svelte`, `browser` and `production`. It takes the files and resolutions from the bundler's metafile, and records host specifiers by name, since the metafile lists the imports Svelte's compiler adds without their written form. The bundle itself is discarded, but building it proves the views compile: a view the compiler rejects fails the build with the compiler's message.

**Refusals at build.** Each of these fails the build:
- a shipped `.js` file that imports `svelte/internal/*`, which is another compiler's output;
- a native addon;
- a computed dynamic import.

**The manifest.** A view's entry names its `.svelte` file inside `dist/ui/` (`entry`). The `csp` field goes, because no view has an origin of its own. `build.hash` covers the view sources, so a rebuild that changes only views changes the declaration and republishes the views. The process revision (`build.outputs`) leaves `dist/ui/` out, so the process keeps running.

**Barrels cost.** A graph holds every file its imports load. Importing two icons through the `@lucide/svelte` barrel loads all 1714 icon components (run D), so the `plugins` skill tells agents to import such a library by its deep paths.

## Compiling

`views` (server) owns compiling, in `views/modules/`.
- **Trigger.** Every publication of a plugin's `views` contribution records the set and forks the compile. A withdrawal cancels a compile still running.
- **Key.** `plugins`' digest service, the worker that computes process revisions, digests `graph.json` and every file it names (purpose `views`). The compile key combines that digest with the compiler's `VERSION`, the compile options, and a format number `views` declares beside the options for its own bundling. When an output directory for the key already exists, nothing is compiled.
- **The worker.** `views/modules/compile.worker.ts` (rule 7a910861) imports `svelte/compiler`, runs `Bun.build`, and answers the outputs or the failure. Its build options:
  - every view entry of the plugin, with `splitting`, ESM, `target: 'browser'` and `minify`;
  - `sourcemap: 'linked'`, so the person's devtools show the plugin's sources;
  - `process.env.NODE_ENV` defined as `production`;
  - content-hashed file names in one flat directory.

  It has two loaders. One resolves only from `graph.json`, with host specifiers external by name. The other compiles: `.svelte` through `compile`, and `.svelte.ts` or `.svelte.js` through Bun's transpiler, then `compileModule`.
- **Compile options are one fact.** `views/contract/wire/compile.ts` declares the window's Svelte options: runes for own files and Svelte's own choice for dependency files, `experimental.async: false`, client, production.
  - The window's `svelte.config.js` reads them, replacing `apps/tagma/app/compilerOptions.js`.
  - The worker reads them too, adding only `css: 'injected'`, so a plugin's component CSS arrives inside its module.
  - A file under `_modules/` is a dependency file.
- **Within one server run,** the worker keeps each file's compile output by its content key, bounded in memory. A rebuild during `tagma-plugin dev` therefore recompiles only the files that changed.
- **One plugin at a time.** Compiles queue in one worker. The worker starts on first need and ends once its queue has stayed empty for a while.
- **Installed files.** While a compile reads a revision's directory, it holds a lease through `plugins`' lease port. Outputs go to `<data>/views/<plugin>/<key>/`, which `views` owns. After each compile and at start, `views` keeps each published plugin's current key and the one before it, from which an open window may still load a lazy chunk, and deletes the rest.
- **State.** Each view of the set reads one of three states:
  - `preparing`;
  - `ready`, with its module's address;
  - `failed`, with the compiler's message and the file it names.

  A failure is also reported to `plugins` as a fault of the plugin; a success or a withdrawal clears it.

**The plugin's card.** `plugins` gains `PluginFaults`: an owner reports a fault it finds after publication with `put(plugin, point, reason)` and `clear(plugin, point)`, and `read_plugins` rows carry the faults. The card shows a fault as one sentence, "A view of this plugin does not compile", with **Fix with an agent**, whose thread holds the compiler's message. A fault never withdraws the plugin's other contributions: its tools and schedules stay. The same port serves any later fault an owner finds, so the parent's card needs no second mechanism.

## Serving

`views` serves two GET routes under its own `/api/views/` (explanation 8c5b6812). Each is a caller of the door, so the remote door reaches them only behind device admission.
- `/api/views/modules/:plugin/:key/:file` serves a compiled module, chunk, source map or icon.
- `/api/views/sheet/:file` serves the utilities sheet.

Both answer as `immutable` with a year's `max-age`, since each address is its content.

The routes need no project: a module is code, and the server still admits every call a view makes in the mount's project (`mounted` in `views/shelf.ts`). The view set carries each section's and pane's icon as one of these addresses. The dev front reaches both routes through its `/api` proxy.

## Host modules and the import map

**The list** has two parts:
- the client exports of the window's `svelte` package: `svelte`, `animate`, `attachments`, `easing`, `events`, `internal/client`, `internal/disclose-version`, `internal/flags/async`, `internal/flags/legacy`, `internal/flags/tracing`, `legacy`, `motion`, `reactivity`, `reactivity/window`, `store` and `transition`;
- `@runlith/tagma/ui`.

The window build reads the Svelte part from `svelte/package.json`, so a Svelte release that adds an export joins with no edit. `compiler`, `server`, `internal/server` and the type-only `action` and `elements` are not host modules, and a view that imports one fails to load.

**The build.** The window's own Vite config gains a plugin, `hostModules()`, beside `surfaceVersion` in `scripts/surfaceConfig.ts`:
- **In the client build,** it calls `emitFile({type: 'chunk', id, fileName: '_app/host/<name>.js', preserveSignature: 'strict'})` for each host module. `@runlith/tagma/ui` is `features/plugin-views/ui.ts`.
- **In the dev front,** it answers `/_app/host/<name>.js` with `export * from '<specifier>'`. Vite compiles that to the optimizer URL the window's own components import (run C).
- **In both,** it fills `PUBLIC_HOST_MODULES`, which `app.html` writes into `<script type="importmap">` ahead of `%sveltekit.head%`. SvelteKit never calls `transformIndexHtml`, but it fills the `%sveltekit.env.PUBLIC_*%` placeholder in both the build and the dev front.

**The paths never change,** so the import map is the same text in every build. A facade's content changes with each build, and the door serves `/_app/` with `no-cache`, so a reload revalidates it. A facade adds a re-export, never a copy.

**The `/ui` door.** `features/plugin-views/ui.ts` is its implementation. The published `@runlith/tagma/ui` is a type facade the kit generates from it ([[5067fa15]]).

## The utilities sheet

**What the window build leaves.** `hostModules()` writes `_app/host/utilities.json` into the surface. It holds:
- the window's class candidates, from the same scan its own Tailwind made;
- every stylesheet `app.css` reaches, as the build resolved it: its own, the chat kit's theme, `tokens.generated.css` ([[ca575591]]) and Tailwind's own.

The server therefore needs no resolver and no file of the app.

**What the server makes.** `views` reads the artefact of the surface the doors serve, through a port, `WindowStyles`, that composition fills from `surfaceRoot`. With no installed surface the port answers none, and no sheet is made. In the compile worker, the pure `tailwindcss` compile, loading stylesheets only from the recorded map, compiles

```css
@reference "<app.css>";
@import 'tailwindcss/utilities.css' layer(utilities);
```

and builds it over the window's candidates and those of every published plugin's `graph.json`. `@tailwindcss/node`'s `optimize`, the step the window's own build runs, puts the result in the same form.
- **Contents.** The sheet holds only `@layer utilities`, the `@property` rules and the `properties` layer.
- **Address.** It is content-hashed and served by the route above. It is keyed by the hash of the window's artefact and the plugins' candidates, kept under `<data>/views/sheet/`, and a key whose file exists is not regenerated.
- **In the feed.** `PluginViewState.sheet` carries its address. The address is null when every plugin candidate is already one of the window's.

**Why a union.** Tailwind orders utilities that conflict on one element. A sheet of plugin-only classes appended after the window's would let a plugin's `p-2` beat the window's `px-3` on every `Button` in the window. The union holds every class of both, in Tailwind's one order and in the same `utilities` layer, after the window's own sheet. So for any two classes, the union decides as the window's own build would. Switching themes never regenerates it, because utilities read the theme's variables.

**When it changes.** It regenerates when the set of published plugins' candidates changes: an install, an update, a first enabling, a removal, a view rebuild. It is never made per project. Every window gets the one sheet, and unused classes cost nothing.

**In the window.** `PluginModules` (below) adopts the sheet as one constructed stylesheet appended to `document.adoptedStyleSheets`. It replaces the previous sheet in the same step and keeps it while the feed names that address.

**In the dev front,** the server has no artefact of the sources being edited, so the window ignores `sheet`.
- `hostModules()` appends `@source inline("<candidates>")` to the transform of `app.css`, as `rootSources` appends `@source` lines, using the candidates that `GET /api/views/candidates` answers.
- A new plugin's classes arrive with the next regeneration of `app.css` or a reload.
- Composition picks the dev or the built filler of the window's `UtilitiesSheet` port.

## Mounting

`app-plugin-views` owns the mount.

**`PluginModules`** (app tier) owns three things:
- loading each module once per window, with `import(url)` held as a `Deferred` per address;
- the sheet;
- preloading. When a project's view set arrives, it preloads the module of every `results` view, so a tool card's row has its geometry when it first draws (explanation 8b7128c3). Sections and panes load when opened.

**`PluginView.svelte`** keeps its props and every place that mounts it today: a section, a pane, a launcher window, a floating panel, a tool card, a pin. It opens a `PluginMount` screen (one per mounted component, a `Screen` of `@runlith/layer`) holding the mount's facts and its client. It then draws by the view's state:
- **`preparing`, or the module still loading:** the pending mark (`Waiting`) with "Preparing <title>".
- **`failed`:** a `Callout` with "This view does not compile" and **Fix with an agent**.
- **`ready`:** the module's default export, keyed on its address, inside its own `<svelte:boundary>`. A failure caught there draws the same callout, with the error's message.

**An update** moves the address. The `{#key}` unmounts the old component and mounts the new one, and the old module stays in memory until the window reloads ([[d2b5f488]]).

**Slots** take a module the same way. A slot's owner decides where it stands, and shows a plugin's part only in threads of projects where the plugin is enabled.

## The view client: `useTagma()`

`useTagma()` answers `PluginMount.use().client`, so it works in a view component's init, and two plugins on one screen each get their own mount. Every member is built from a window service, and no message crosses a frame:

| Member | Built from |
|---|---|
| `projectId`, `plugin`, `view`, `threadId`, `key` | the mount |
| `tools.<name>(input)` | `call_plugin_tool` through `Door`, as today. The server checks the tool's `view` audience in the mount's project. The call answers the handler's value; an `isError` result or a refusal throws `TagmaRefused`, as in the process client ([[5067fa15]]) |
| `resource(uri)` | `views.resource.subscribe` through `Live`, as a reactive value |
| `storage` | `read_view_storage` and `write_view_storage` |
| `thread(id)` | `ThreadPresence.watch` |
| `transcript(id)` | the projection over `ThreadChats` that step 4 builds ([[c4451a7e]]) |
| `open(...)`, `openLink(url)` | `ShellOps` and `ExternalLinks` |
| `servers.<name>.call` | `call_contributed_tool` of `mcp` ([[d2b5f488]]) |
| `theme` | `Theme.look` ([[ca575591]]) |
| `speech` | the `speech` capability |

- **Reactive values** are built on `createSubscriber`. A read never writes, a subscription opens with its first reader, and every subscription closes with the mount's scope.
- **Capabilities other modules own.** `TagmaMethods` becomes `ViewCapabilities`. A module contributes a member: its name, a description and a reference, all declared in the module's server wire for the `plugins` skill (note 3a3e6fcc), and `make(mount)`. Speech contributes `speech`: its `viewSpeech.ts` logic without JSON-RPC, where the mount's scope does what `ViewFeeds` did per mount.
- **What goes with the bridge:** `HOST_BRIDGE`, `BRIDGE_METHODS`, `bridgeMethod`, the notification names and the `tagma/*` capability strings.
- **No click gate.** The check that `open` opens a thread only from a click goes: it guarded framed code, and a view's code now runs in the window.
- **A shared realm.** A view runs in the window's document with the window's authority. `useTagma()` is the surface a view is written against and the one its attribution rests on, but nothing walls off the rest. This is the parent's "shared window" risk, accepted under rule 06e41b6f.

**What `/ui` exports:**
- `useTagma`;
- `<Frame>`;
- the face types of the slots (below);
- the window's own primitives a section needs, from `app-shared`: `Button`, `Input`, `Textarea`, `Tooltip`, `Kbd`, `FadeText`, `PathText`, `Glyph`, `TileMeter`, and the dropdown-menu and dialog compounds.

`<Thread>` joins in step 6. A component joins `/ui` by being exported from `ui.ts`, and the kit's facade follows.

## `<Frame>`

`Frame.svelte` and `parking.ts` move from `features/views` to `lib/shared/frame/`. Pages (`PageView`, `MotionView`), MCP App windows and plugin views then import one iframe, and its `protocol` becomes optional.

`<Frame src title height? fill?>` from `/ui` is that component, with the sandbox plugin views have today (explanation a9714f0d):
- `sandbox`: `allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups`;
- `allow`: fullscreen, autoplay, encrypted-media and picture-in-picture.

The framed page stays on its own origin and reaches no Tagma API. It keeps its own keys ([[ba083eb0]]) and its own look ([[ca575591]]).

## Slot faces in this step

A slot's owner declares the props a plugin module receives in that slot, and `/ui` exports that type.
- **Tool cards.** The card mounts the `results` point's view as a module, with props `{name, input, output, state: running | done | refused, threadId}`, the face [[c4451a7e]] defines. `/ui` types `input` and `output` from `typeof plugin`. The face lands in this step because the frames it replaces go here, and `live` keeps its meaning.
- **Sections, panes and launcher windows** take no props: the view reads its place from `useTagma()`.
- **Composer parts, prompt commands and hooks** stay in step 7.

## MCP App windows move into `app-mcp`

`ViewFrame.svelte`, `ResultFrame.svelte`, `ViewBridge.ts`, `hostStyles.ts`, `params.ts`, `resourceFeed.ts` and `toolNotices.ts` move into `features/mcp`, beside `AppView.svelte`, the only host they still serve.

Behaviour does not change:
- the two-layer proxy (explanation 960e5e20);
- the bridge, tied to the mounting;
- the host context, re-sent on `Theme.look`.

`app-views` (`d7074a11`) ends and its card is retired. `app-mcp` (`212858cf`) and `app-shared` take its parts.

## What goes

- **Plugin origins:**
  - `views/files.ts`, and `PluginViews.file` and `csp`;
  - `ViewSites`, `LocalSites` and `remoteSites`;
  - plugin dispatch by Host on the sandbox listener (`composition/http/sites.ts`);
  - the `[::1]` hold (`loopbackSix`), since the MCP proxy's local origin is `127.0.0.1`;
  - the remote per-plugin Serve ports: `WantedSites`, `PlacedSites`, `remote/placements.ts`, the `remote_site` table, explanation a7089c76;
  - the `site` of the view set.

  The sandbox listener keeps only the MCP proxy. The `Sec-Fetch-Site` refusal on the remote door stays, because the MCP proxy's remote origin still shares the door's site.
- **The bridge for plugin views:** `tagma/*`, `TagmaMethods` in its JSON-RPC form, `ViewFeeds`, `sectionOpen.ts`'s parameter decoding, and `features/views/reach.ts`.
- **Keys:** `served` in `WindowKeys`, `Keymap.serve`, and the served-origin filter of `Keymap.run` (agreed with [[ba083eb0]]).
- **Machine load:** the `PluginView` document of `executions/load` and the frame name that carried it. A view runs in the window's renderer, so its cost is the window's.
- **`.html` view entries** and `csp`. By rule 0528876d, a plugin with HTML views shows them again only once it is rebuilt with Svelte views.

## Modules after the change

**Server:**
- `views` (`3d78b068`): the compile owner and its worker, the two routes, the sheet, the `WindowStyles` port, and capability declarations in place of bridge methods. It loses site serving.
- `plugins`: `PluginFaults`, and its digest service reachable from `views`.
- `remote` and composition lose plugin sites. `mcp` is unchanged.
- `executions` loses the `PluginView` load document.
- `speech`'s capability declaration replaces `SPEECH_BRIDGE`.
- The server adds `svelte` (its compiler), `tailwindcss` and `@tailwindcss/node` with its native `lightningcss`, carried by the cut the way `sharp` is. `@tailwindcss/oxide` stays out: the window build and the SDK scan for candidates.

**Window:**
- `app-plugin-views` (`9cc7259f`): `PluginModules`, `PluginMount`, `ui.ts`, `ViewCapabilities` and the mount's states.
- `app-mcp`: MCP App windows. `app-shared`: `Frame`. `app-views`: ends.
- `features/pages` imports `Frame` from `shared`.
- `features/threads/native` declares the tool card's face.
- `app-keys` loses `served`.
- Composition (`runtime.ts`) fills `UtilitiesSheet` by build mode.
- The window build: `hostModules()`, the import map in `app.html`, and `svelte.config.js` reading the compile options.

**Packages:** `@runlith/tagma` gets the view graph in `tagma-plugin build`, depends on `svelte` and `@tailwindcss/oxide`, generates the `/ui` facade, and its `view()` helper writes `entry`.

```
author   ui/*.svelte ─ tagma-plugin build ─→ dist/ui/ files + graph.json (resolutions, candidates)
publish  plugin-host ─ views.register ─→ digest (plugins) → key → compile.worker: Bun.build + svelte → <data>/views/<plugin>/<key>/
         candidates (window artefact + every published graph.json) → compile.worker: tailwind → sheet
feed     views.subscribe → views[].module: preparing | ready(url) | failed · sheet
window   PluginModules: import(url) → import map → /_app/host/* → the window's own Svelte · adopted sheet
         PluginView → PluginMount → <svelte:boundary><Module …face/></svelte:boundary> → useTagma() → Door · Live · ThreadPresence · ShellOps · Theme
```

## Cost on every machine

Every figure in Measured is one sample from an Apple M2 Max with 12 cores and 32 GB. A weaker machine pays several times more. All of the work runs in a worker or once per change, never per frame or per press:
- **A view build:** tens of milliseconds for a plugin of a few components; half a second for a graph of 1714 components. It runs once per plugin revision and Svelte version, and within one run only for the files that changed.
- **The first compile after start:** about half a second for the compiler to load, once per worker life.
- **The sheet:** about 35–45 ms per regeneration and 135 KB, parsed once by each window when the set changes. A machine whose plugins add no class gets no sheet.
- **Mounting:** one module import per view per window, from loopback or the remote door, cached immutable.
- **Weight:** the server carries the compiler (0.88 MB minified), Tailwind, and `lightningcss`, which is native (8.1 MB on darwin-arm64).

The cost grows with the plugins' own files, never with projects, threads or repository size.

## What is not needed

- a link step, its cache, or relinking after a Tagma update (the import map links);
- an origin, a CSP, a port or a remote Serve mapping per plugin;
- JSON-RPC between a plugin view and the window;
- a sheet per plugin or per project;
- candidate scanning on the server;
- a compile per view, or a compile at install;
- a disk cache per file;
- import maps added at run time, which some browsers lack: the one map in the shell never changes;
- hot module replacement of plugin modules: a rebuild remounts;
- a check that the window's and the compiler's Svelte match: one lockfile and one cut carry both.

## Order inside step 5

1. **Host modules.** `hostModules()`, the import map, and the compile options in `views`' wire.
2. **Compiling.** The view graph in the SDK build; the compile worker, the routes, the states and `PluginFaults`.
3. **Mounting.** `PluginModules`, `PluginMount`, `useTagma()`, `ui.ts`, `ViewCapabilities` with speech, and the tool card's face.
4. **The sheet.** The window's artefact, the union, and the dev front's `@source inline`.
5. **Removals.** Plugin origins and remote ports, the bridge for plugin views, `served`, the load document, and `app-views` split into `app-mcp` and `app-shared`.
6. **Text.** The `plugins` skill (rule 7cb3c1cf) and the blocks below.

## Acceptance

Performer checks, each through the door its real caller uses (rule 571311f8):
- **A section in the window.** A headless e2e on the built surface (testbed). An acceptance plugin in a folder carries:
  - a section that imports `Button` and `useTagma` from `@runlith/tagma/ui`;
  - a `.svelte.ts` store shared by the section and a tool card;
  - a deep import of a Lucide icon;
  - a Tailwind class the window does not use.

  `install_plugin` from the folder, then `enable_plugin`. `views.subscribe` reads `preparing`, then `ready`. Opened, the section draws the window's `Button` and calls its own `view` tool. The store's change in the section shows in the tool card. Its own class applies, and a `Button` elsewhere in the window keeps its padding.
- **One runtime.** In that e2e, `document.querySelector('script[type=importmap]')` lists every host module, and the plugin's component reads a context the window set through `useTagma()`.
- **A refused compile.** A `dist/ui/` file the compiler rejects, placed after the build, makes `views.subscribe` read `failed` with the compiler's message and file. The `read_plugins` row carries the fault, and an agent's call of the plugin's tool still answers.
- **A view-only rebuild.** `tagma-plugin build` after a change to a `.svelte` file republishes the views. An open window remounts from the new address, and the plugin's process generation stays the same.
- **No work at start.** A second server start compiles nothing and regenerates no sheet: the worker never starts.
- **The sheet.** With the plugin enabled, `sheet` names an address whose sheet holds the plugin's class inside `@layer utilities`. Disabling it everywhere makes `sheet` null.
- **The dev front.** An itest of `hostModules()` with Vite in middleware mode: `/_app/host/svelte_internal_client.js` re-exports the URL a window component imports, and the shell carries the import map.
- **MCP Apps.** The MCP App window's tests move with its files and pass unchanged.
- **Removals.** `http://<id>.localhost:<sandbox port>/` answers 404, no `remote_site` table remains, and `WindowKeys` has no `served`.

## Measured

Each run is one sample on the machine named above. The scripts lived in the throwaway directory, so the record alone cannot reproduce them.

- **A. Host modules in the build.** A SvelteKit app with `adapter-static`, the window's compile options, and a plugin emitting 16 host modules (Svelte's 15 client exports without `legacy`, plus a `/ui` file) at fixed paths with `preserveSignature: 'strict'`.
  - Every named export was kept, for example 197 of 197 for `svelte/internal/client`.
  - Rolldown emitted each facade as re-exports of shared chunks. The runtime's error names (`effect_update_depth_exceeded`, `state_unsafe_mutation`) stood in exactly one chunk, which the page's nodes and the facades all import.
  - `%sveltekit.env.PUBLIC_*%` wrote the import map into the built shell.
- **B. One runtime, in jsdom.** A plugin view bundled separately (`Bun.build` with `svelte/compiler`, host specifiers external), its host specifiers mapped to the built facades, was mounted with the window's `mount`. It read the window's context through `/ui`'s `useTagma()`, drew `/ui`'s `Button` inside itself, updated its own `$state` on a click, wrote into the window's `SvelteMap`, injected one `<style>`, and drew two Lucide icons. With `svelte/internal/client` pointed at a second copy, mounting threw at once.
- **C. The dev front.** The shim at `/_app/host/svelte_internal_client.js` was served as `text/javascript`: `export * from "/node_modules/.vite/deps/svelte_internal_client.js?v=e14bde87"`, the URL the page's own component imports. The served shell carried the import map.
- **D. One plugin's views.** Three runs of `Bun.build` with Svelte, for a view of five components and one `.svelte.ts`:
  - with icons imported by deep path, 52–74 ms (compiling 44–52 ms), plus 50–248 ms to load the compiler;
  - with the same icons through the `@lucide/svelte` barrel, 1714 components compiled in 504–674 ms;
  - output 4.4 KB either way.

  Inside a Bun `Worker`, the build ran in 147 ms warm and 791 ms on the first cold run.
- **E. Compiling one file.** The app's own 709 `.svelte` files compiled with the window's options: median 1.3 ms, p95 8.7–8.9 ms, max 25–41 ms. Its 209 `.svelte.ts` modules took 534–817 ms in all.
- **F. The recorded graph.** The author-side bundle's metafile gave 13 files (7.4 KB) and their resolutions. Bundled from `graph.json` alone with no `node_modules`, they took 10–12 ms and gave the same code, differing only in minified local names.
- **G. Tailwind over the app.** 12,911 candidates; the scan took 62–132 ms at build.
  - **The window's full sheet:** compile 18–25 ms, build 33–66 ms, optimize 11–35 ms; 186 KB raw, 159 KB optimized.
  - **The union:** compile 5–7 ms, build 19–29 ms, optimize 8–13 ms; 159 KB raw, 135 KB optimized. It holds the `dark` variant and the app's own `@utility` classes.
  - **A rejected form:** `@tailwind utilities` without `layer(utilities)` emitted unlayered utilities, which would beat every layered style of the window.
  - **Replay:** loading only seven recorded stylesheets (65 KB), the pure `tailwindcss` compile gave output byte-identical to `@tailwindcss/node`'s, in 51 ms. `@source inline` adds its candidates.
- **H. Weight.** The Svelte compiler bundled and minified is 0.88 MB, and Tailwind's `dist` is 772 KB. The native `lightningcss` for darwin-arm64 is 8.1 MB, and the native `@tailwindcss/oxide` is 2.8 MB, which stays out of the server.

## Text that follows

These are rewritten when the code lands:
- explanations a9714f0d and a7089c76, retired;
- explanation 960e5e20: MCP Apps only, its sources moved into `features/mcp` and `lib/shared/frame`;
- explanations 178c84d6 (the mount supplies the identity of every call), 3a3e6fcc (capabilities), ace6da34 (speech) and bdc83669 (MCP Apps only);
- the cards of `views`, `app-plugin-views`, `app-mcp`, `app-shared` and `mcp`, and the retirement of `app-views`;
- the `plugins` skill: Svelte views, `useTagma()`, `<Frame>`, `/ui`'s components, deep imports and Tailwind tokens.

## Not established

- **The browser's import map.** That Electron 44's Chromium and Safari resolve the bare specifiers of a module loaded by `import()` from `/api/views/modules/` through the shell's import map. Run B mapped the specifiers with `Bun.plugin`, not a browser; this rests on the HTML standard.
- **Dev runtime.** A module compiled with `dev: false`, mounted on the dev front's development runtime.
- **Component types.** That the kit's expansion (explanation ade3bab6) generates the props types of the Svelte components `/ui` exports. It likely needs `svelte2tsx`'s `emitDts`.
- **`svelte.config.js` reading a TypeScript wire.** It works under `bun run --bun vite build`; whether every caller of the config, `svelte-kit sync` and `svelte-check` included, runs under Bun was not checked.
- **Admission of `GET /api/views/candidates`** from Vite's process on the local door, with no session header.
- **A window older than the server.** Whether an update reloads open windows (`ClientBuild`) before they mount modules a newer Svelte compiled.
- **Resource use.** The compile worker's memory at rest, and the cost of the sheet on the weakest machine Tagma serves.

## Open for the operator

- **Camera and microphone in `<Frame>`.** Should a site that a plugin frames, such as a meeting app, be able to ask for the camera and microphone? Today's `allow` grants fullscreen, autoplay, encrypted media and picture-in-picture; adding the camera and microphone would let the browser, or Tagma's desktop, ask the person.
