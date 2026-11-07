---
id: 01a1b32d-42a6-75fa-b388-7072f70d7231
title: "Providers as plugins: model, harness and speech providers install through install_plugin and load through one loader"
ord: 8
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a1ad53-a8b9-7fa9-98a0-71655067fa15
---
Step 8 of [[d2b5f488]]. Read from the code at `f5c7ab612` on 2026-11-07; nothing was run.

## Outcome

A model provider, a CLI harness and a speech provider reach Tagma the way everything else at the side does: as a plugin. An agent writes it with the SDK, `install_plugin` installs it from a folder, git, npm or a marketplace entry, and its providers appear in the model menu and in Settings → Speech without a rebuild or a restart of Tagma. The providers Tagma ships stand on the Plugins screen as built-in plugins. `install_adapter` and its records are gone.

## What stands

- **Model and harness adapters** install through their own family: `install_adapter`, `update_adapter`, `remove_adapter`, `disable_adapter`, `enable_adapter`, `read_adapters` (`providers/contract/wire/operations.ts`, handlers in `providers/operations.ts`), the `tagma adapter` verb (`providers/cli/adapter.ts`) and the adapters section of the Providers screen (`app/…/features/providers/adapters/`). An install is an npm package, a GitHub repository or a folder, fetched and `bun install`ed into `<data>/adapters/<name>@<version>/`, recorded in `installed.json` (`providers/adapters/{fetch,record,installs}.ts`).
- **Loading** is `importAdapter` in `@runlith/tagma/adapter/loader`: it reads the package's `exports`, serves the host modules once through `Bun.plugin` and refuses without `--no-install` (explanation 6cdd67c3). The registry (`providers/registry.ts`) loads built-in sources (`composition/adapters.ts`, `BuiltinAdapters`) and machine sources (`providers/adapters/external.ts`), judges each (`judge.ts`), pins a run's catalog (`pinRun`/`forRun`/`releaseRun`), and writes `harnesses.json` so a CLI hook imports only the package of its harness (explanation bdbe083e, `composition/cli/installedHarness.ts`).
- **Holding a version** (explanation f928125d): `AdapterInstalls.hold` leases a directory for an ask or a launch; `PackageHolders` (`external-harnesses/store/packages.ts`) names what current harness rows and live sessions hold; the sweep in `installs.ts` deletes the rest.
- **Speech** is a fixed list compiled in: `Speech.layer(providers)` in `packages/speech/src/engine/Speech.ts` builds one `speechCatalog` at layer construction; `composition/speech.ts` passes `[soniox, openai, whisper]`. `KEYED_SPEECH` is computed from that list once and reaches `providers` as `KeyedProviders` for the console-key window.
- **Plugins** (`plugins/`) install every format into `<data>/agent-plugins/<id>/`, replaced whole on update, or read a folder in place. A plugin is enabled per project and for all the person's projects; there is no switch for the whole machine. Its manifest (`plugin-formats/tagma`) carries `process` and `contributes`, and no provider part. The SDK build (`packages/tagma/src/plugin/build.ts`) emits no `dist/provider.js`. No built-in plugin exists.
- **The adapter template** (`packages/tagma/kit/create.ts`, `kit/template/`) and `runConformance` (`kit/conformance.ts`) scaffold and test an npm adapter package.

## The provider part

**What the author writes.** `definePlugin` gains `providers: './providers.ts'`, a module path like a view's. That module's default export is `defineProviders({ models?, speech? })`:
- `models` is an `Adapter` made with `defineAdapter` from `/adapter/provider`, unchanged: wire providers, harnesses, settings instances;
- `speech` is a list of speech providers written against the speech contract, published as `@runlith/tagma/adapter/speech`.

A plugin may be nothing but a provider part. A provider part runs in the server process, so it is a separate module from `plugin.ts`: the process bundle never carries provider code, and provider code never reaches the process.

**What the build emits.** `tagma-plugin build` bundles the providers module into `dist/providers.js` with every host module left as an import, so the server's own copies serve them (explanation 6cdd67c3). It refuses a native addon and a dynamic import it cannot bundle, as it does for the process. It imports the module in describe mode through the SDK's host modules, the way conformance does, and writes the manifest envelope `providers: {entry: 'dist/providers.js', models: boolean, harnesses: boolean, speech: boolean}` — `harnesses` when `models` declares a CLI agent — so the card says what the plugin brings without loading it.

**Host modules.** The speech contract's runtime modules join the list the same way the model contract's did: `tagma.host` entries in `packages/speech/package.json` and in each module a speech provider imports. A plugin's speech provider may require only what the host gives every one of them: the HTTP client and the speech kit's WebSocket transport. Whisper's engine and model store stay the built-in's own.

**Testing.** `runConformance` moves to `@runlith/tagma/testing` and takes a plugin folder: it reads `tagma-plugin.json`, imports `dist/providers.js` under the SDK's host modules and drives sign-in, a model call and a failure against a stub, as now. A speech provider is checked against the catalog's consistency rules (`speechCatalog`) and, given a stub, one recognition or synthesis.

**One template.** `kit/create.ts`, `kit/template/` and the `create` bin are removed. The plugin template stays the only one (explanation e87c56d4); the `plugins` skill gains a `providers` reference with a model provider, a speech provider and their conformance test, written against the SDK alone.

## The loader

`@runlith/tagma/adapter/loader` keeps the host-module serving and the `--no-install` refusal, and its one import becomes `importProviders(directory, host)`: it reads the provider entry from the `tagma-plugin.json` in `directory` and answers `{id, version, models?, speech?}`, the plugin's id and version beside the module's default export, so a held revision is loaded by its directory alone. `defineProviders` and `ProvidersDefinition` stand in `@runlith/tagma/plugin`, `defineSpeech` in `/adapter/speech`. Package `exports` are no longer read. The registry, the speech catalog and the CLI hook process all import through it, so one revision directory imported by two of them is one module instance.

## Plugins: provider revisions, holders and the machine switch

**Revisions.** ESM never unloads, and a CLI hook process imports the codec from its package on every event, so a provider part cannot run from a directory an update rewrites. `plugins` therefore copies each plugin's provider part into `<data>/plugin-revisions/<id>/<revision>/`, where the revision is the content digest of `tagma-plugin.json` and `dist/` without `dist/ui/`, hashed in the plugins digest worker. A copy whose revision already stands is reused. The copy is taken after an install or update settles, at start for every installed plugin whose outputs moved while the server was down, and, for a plugin installed from a folder, when its provider outputs change: `plugins` watches them through the platform tree watcher, so a rebuild in place reaches the catalogs as a rebuild of a process or a view does. The process and views go on running from the install root.

**npm.** The npm fetch of `providers/adapters/fetch.ts` moves into `plugins`' sources, the last path that only adapters had: `PluginSource` gains `{kind: 'npm', name, range}`, the add field reads a package name with an optional range, and the tarball is staged and settled as a git clone is. The registry is the one the machine's npm configuration names (`npm_config_registry`), npmjs.org when none is set, so a company registry works and a test reaches a stub through the same door. Nothing is installed after it: the build already bundled the plugin's dependencies.

**Provider parts.** `plugins` answers the provider parts that stand, with a change stream: for each plugin carrying one, its id, title, version, whether it is built in, its revision directory (none for a built-in), what it brings, and whether it is switched off on the machine. Providers stand machine-wide: project enabling does not apply to them (scope table of [[d2b5f488]]).

**Holders and the sweep.** The lease, the holders and the collection of explanation f928125d move from `providers/adapters/installs.ts` to `plugins`, over revision directories, with the same guarantees: a lease is taken only while its directory stands, and a collection decides and renames every deleted directory away in one synchronous step against the live leases. A revision is kept while it is the current one of an installed plugin, a lease holds it, or a registered holder names it. `providers` registers its pinned and current catalogs; the harness owner registers its current rows and the versions live sessions recorded. Collection runs at start, after each install, update, uninstall and new revision, and when the last lease of a revision that is no longer current ends.

**The machine switch.** A user-scope list, `plugins.off`, holds the plugins switched off on this machine; `enable_plugin` writes it with `scope: 'machine'`. A plugin on it runs in no project whatever the other two lists say — the one place that decides `running` (`enablingIn`) reads it — so its process and contributions stop everywhere, and its providers leave the catalogs. Switching it on again restores what its project and personal enabling say. This is the card's **Turn off everywhere**; **Stop in all my projects** keeps dropping the personal layer.

**Built-in plugins.** Composition lists the providers Tagma ships as built-in plugins, one per vendor, each carrying the code it compiles in: Anthropic, OpenAI (its models, Codex and its speech), Cursor, xAI, Google, Muse, Devin, OpenCode Go, OpenCode, StepFun, DeepSeek, OpenRouter, OpenAI-compatible server, Soniox, and Whisper. `plugins` answers them as rows of their own origin: no source, no install root, never in `plugins.installed`. `uninstall_plugin` refuses one, naming the machine switch as the way to turn it off; an install whose id a built-in holds refuses `plugin-id-taken`. The only act on a built-in is the machine switch.

**Faults.** A provider part that fails to import or declare, or declares a provider id another part holds, is put on its plugin as a fault through `PluginFaults`, with the loader's reason, and is cleared when a later load succeeds. Each half has its own point, named by `PROVIDER_FAULTS` in the plugins wire: `providers` for the models half, put by the registry; `speech` for the speech half, put by speech's filler; `revisions` when `plugins` could not copy a build into a revision or no longer reads a plugin whose part stood. The card then reads broken with **Fix with an agent**.

## Providers

- **Sources.** The registry loads built-in sources and every standing provider part with `models`, in that order and then in install order, so an id collision fails the later part. A part switched off on the machine reads disabled, as a disabled adapter does now. The registry reloads on every change of the parts.
- **Holding.** Asks and launches take their lease from the revision store; the registry registers its holders with it. `ProviderRegistry.loadVersion` reads a held revision directory the same way, by its `tagma-plugin.json`.
- **The harness index** stays providers' projection (`providers/harnessIndex.ts`, `<data>/provider-harnesses.json`); its rows name revision directories, and the hook process imports a row only while its directory stands (explanation bdbe083e).
- **The port** is `AdapterSources` (`current()`, `changes`, `host`), filled by `composition/adapterSources.ts`: the built-in adapters first, each disabled while its built-in plugin is off, then every standing part that brings models.
- **Removed:** `install_adapter`, `update_adapter`, `remove_adapter`, `disable_adapter`, `enable_adapter` and `read_adapters`; the `tagma adapter` verb; `AdapterInstalls`; `providers/adapters/{fetch,record,installs,external}.ts`; `installed.json` and `<data>/adapters/`, which nothing reads and the new server removes at start. Refusal hints that name `install_adapter` or `read_adapters` (`cli/verbs/mcpServe.ts`, `external-harnesses/cli/hook.ts`, `notInstalled` in `providers/contract/service/registry.ts`) name `install_plugin` and the Plugins screen instead.
- **Kept:** adapter settings instances — `read_adapter_settings`, `save_adapter_instance`, `remove_adapter_instance`, `discover_adapter_models` — which configure a loaded provider, not an install.

## Speech

**A catalog that reloads.** `Speech.layer` takes a source of providers with a change stream instead of a fixed list, and the service answers the current set: `now` gives a `SpeechSet` — today's service surface (`recognition`, `synthesis`, `status`, `recognizer`, `voice`, `recognize`, `transcribe`, `resume`, `discard`, `synthesize`) bound to one catalog — and `changes` streams each new one. A provider is checked against the consistency rules when its part loads; one that fails, or repeats an id, is left out with its fault on its plugin, so one bad plugin never empties the catalog.

**A listening keeps its catalog.** Every piece of work that spans calls takes one set at its start and keeps it to its end: a recognition from its choice to its last utterance, a synthesis from its voice to its last sample, a transcription from its job to its result. A provider withdrawn mid-way finishes the work it started; the next work reads the new set. One-shot reads take `now`.

**Sources.** Composition fills speech's port with the built-in providers, under their built-in plugins, and the speech of every standing provider part, through the loader. A part switched off on the machine leaves the set.

**Keys.** `KeyedProviders` answers the ids of the current set's providers whose credential is required, read per use, so a key for a plugin's speech provider is entered in the console-key window like a built-in's.

## Screens

- **Plugins screen.** The project list gains its third group, "Built into Tagma", beside plugins and MCP servers. A built-in's card names what it brings in plain words — models, a CLI agent, speech — and offers only **Turn off everywhere** or **Turn on**. A plugin's card names a provider part the same way, and offers **Turn off everywhere** among its other acts; a plugin that is only a provider part offers no project enabling.
- **Providers screen.** The adapters section and its install, update, enable, disable and remove controls leave the screen. Its "Add a provider" is the Plugins screen's add field, the same component, which installs through `install_plugin`. A provider that failed keeps showing its failure in place, with a link to its plugin's card.
- **Settings → Speech** lists a plugin's speech provider as soon as its catalog changes.

## Modules and text

- `plugins` owns revisions, holders, the sweep, the provider parts, built-in rows and the machine switch. It imports neither `providers` nor `speech`.
- `providers` drops its install machinery and reads its sources through its own port, filled by composition from `plugins` and the loader; `speech` declares its own port the same way. Their module cards, and `plugins`' card, are rewritten to say so; any new relation goes through `set_module`.
- `@runlith/tagma` gains `/adapter/speech`, `importProviders` and the provider half of `/testing`, and loses the adapter template; the kit card (`e0801f50`) says so.
- Text written in the same change, by rule 7cb3c1cf and the rule that a change breaking an explanation corrects it: the `plugins` skill and doctrine; explanations 6cdd67c3, f928125d, bdbe083e, 28498339, 07c6506c and e87c56d4; feature d7d24be1 where it names how a provider is added.

## Acceptance

Performer checks, each through the door a real caller uses.

- **A model provider.** An agent creates a plugin, adds a providers module with a wire provider aimed at a local stub, builds and installs it from the folder. Its model is in `read_models`, and a thread runs a turn on it, with no restart of the server.
- **A speech provider.** The same plugin adds a speech provider; after the rebuild it is in `speech_status`, and a recognition on a stub returns its words.
- **Updating under a run.** A run that started on revision A keeps answering from A after the plugin is rebuilt to B; the next run uses B; A's directory is deleted once the run settles and nothing else holds it. A recognition started on A keeps A to its end.
- **A CLI harness from a plugin.** A terminal harness provider from a plugin launches; its hook process loads from the revision directory; an update during the session leaves that session reading A's row.
- **Built-ins.** `read_plugins` lists the built-in plugins. `uninstall_plugin` on one refuses. Turning Anthropic off everywhere takes its models and Claude Code out of `read_models`; turning it on brings them back. Turning OpenAI off takes its speech out of `speech_status`.
- **The machine switch on an ordinary plugin** stops its process and withdraws its contributions in every project; turning it on restores them where its enabling says.
- **A broken part.** A provider part that throws on import leaves every other provider standing, and its card reads broken with the loader's reason. A second plugin declaring an id the first holds reads broken naming the holder.
- **From npm.** A provider plugin published to a local registry stub installs by its package name and its provider appears in `read_models`.
- **The SDK.** `tagma-plugin build` emits `dist/providers.js` with host modules left as imports and the `providers` envelope; `@runlith/tagma/testing` runs conformance over the folder with no Tagma running.
- **Nothing old.** The adapter operations and verb are gone, `<data>/adapters/` is not read, and the template builds only plugins.

## Not established

- Whether a Bun module graph imported through `Bun.plugin` virtual modules leaks across many revisions of one plugin in a long-lived server: each revision stays in memory until restart, as each adapter version does now (explanation 6cdd67c3).
- Which speech kit modules a provider imports at run time beyond its types; the builder lists them from the built-in providers.
