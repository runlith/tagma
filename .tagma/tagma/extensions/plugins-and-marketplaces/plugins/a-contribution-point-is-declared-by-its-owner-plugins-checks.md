---
id: 01a12320-6df6-76cb-a826-b1be7d2dc40e
title: A contribution point is declared by its owner; plugins checks a package's contributions against it, and plugin-host publishes them while the plugin is enabled
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
---
A contribution point belongs to the owner of what a plugin writes into, not to `plugins` or `plugin-host`: the next capability is added as a new point at its own owner, with no edits to the manifest reader or the supervisor. The point is the owner's one `ContributionPoint` (`platform/contract/service/contribution.ts`), the same declaration compiled modules contribute to; the owner opens it to plugins by giving it a plugin face: the `contributes` name, the schema, and the keys a contribution occupies (`claims` — two plugins on one key refuse, naming the holder). A plugin-only point's typed face is `never`. When assembling its layer the owner binds the face to its `register`, returning a disposer, through `PluginPoints.declare(point, register)`; `sibling(point)` reads another point of the same manifest. Keys are taken in one synchronous step before the first `register`, so two plugins published at once do not take one key.

The registry is `plugins`', so a package is checked before it is installed: `install_plugin` decodes each `contributes` entry with its point's schema and refuses `plugin-refused` on a point no owner declares, naming the declared ones, or on a value the schema rejects. Nothing is silently lost. Declarations must stand before the first process starts: composition calls `PluginHost.start` once the runtime is assembled.

Contributions are published while the plugin is enabled in at least one project and its manifest reads, whether or not a process runs: `plugin-host` publishes them when it takes the plugin up and again on every new declaration, and withdraws them when no project enables it. `register` takes the manifest's value and the caller going through the supervisor, whose every call is a demand that opens the process when none runs. A check that needs a sibling point — a tool the manifest's `tools` does not name with audience `tagma`, a view `views` does not name — fails at publication and shows as the plugin's `failed`, not as an install refusal. Registration is shared per machine, like the process; project visibility (`EnabledPlugins.held`) is filtered by the point owner itself.
