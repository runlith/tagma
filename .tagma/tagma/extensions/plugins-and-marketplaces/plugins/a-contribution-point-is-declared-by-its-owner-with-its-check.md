---
id: 01a12320-6df6-76cb-a826-b1be7d2dc40e
title: A contribution point is declared by its owner with its checks; one function checks a package's contributions at install and in the build, and plugin-host publishes them while the plugin is enabled
ord: 10
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12306-efba-7a0e-94d7-05ecc0602266
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/contribution.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/contract/service/points.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/points.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/contract/wire/contributions.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/wire/contribution.ts
---
A contribution point belongs to the owner of what a plugin writes into, not to `plugins` or `plugin-host`: the next capability is added as a new point at its own owner, with no edits to the manifest reader or the supervisor. The point is the owner's one `ContributionPoint` (`platform/contract/service/contribution.ts`), the same declaration compiled modules contribute to. The owner opens it to plugins with a plugin face declared in its own `contract/wire`:
- the `contributes` name, and the title a person reads for what a contribution there gives (the plugin's row carries it, so the screen holds no list of points);
- the schema;
- the keys a contribution occupies (`claims` — two plugins on one key refuse, naming the holder);
- what it asks of the rest of the manifest: `refuses(value, {plugin, sibling})` for a check against another point (a view `views` does not declare), and `calls(value)` for the tools it names for Tagma to call, which the face that `serves` tools — plugin-host's `tools` — answers for (audience `tagma`). `calls` keeps a point owner below plugin-host free of a dependency on it.

A plugin-only point's typed face is `never`. When assembling its layer the owner binds the face to its `register`, which only registers and returns a disposer, through `PluginPoints.declare(point, register)`. Keys are taken in one synchronous step before the first `register`, so two plugins published at once do not take one key.

The registry is `plugins`', so a package is checked before it is installed. One pure function is the check: `contributionsRefusal` in `plugins/contract/wire/contributions.ts`. It refuses a point no owner declares, naming the declared ones. It decodes each entry with its point's schema, excess properties refused, then runs every face's `refuses` and `calls`. `PluginPoints.check` runs it at install, where a failure refuses `plugin-refused` with the point and the reason, and again on every read of an installed plugin. The SDK's build runs the same function: the kit generator bundles it with the faces (explanation 09039173), so a manifest the build passes is one the install passes, claims aside. Nothing is silently lost. Declarations must stand before the first process starts: composition calls `PluginHost.start` once the runtime is assembled.

Contributions are published while the plugin is enabled in at least one project and its manifest reads, whether or not a process runs. `plugin-host` publishes them when it takes the plugin up and again on every new declaration, and withdraws them when no project enables it. `register` takes the manifest's value and the caller going through the supervisor, whose every call is a demand that opens the process when none runs. What a register still refuses at publication — a tool the model catalog will not accept, an agent file that does not parse — shows as the plugin's `failed`. Registration is shared per machine, like the process; project visibility (`EnabledPlugins.held`) is filtered by the point owner itself.
