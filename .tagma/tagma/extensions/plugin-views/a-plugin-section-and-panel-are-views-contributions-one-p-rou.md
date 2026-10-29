---
id: 01a123c2-a531-77cd-a136-9a7ef9c4cd67
title: "A plugin section and panel are views contributions: one p route, flyweight registration with a disposer, one plugin panel view"
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugins/panes.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugins/SectionPage.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/surface.ts
  - kind: file
    ref: apps/tagma/server/src/views/sections.ts
---
Plugin sections and panels are views' contributions of the same kind as `views` and `results`: a view mounting, not a new view. The `surfaces` and `panes` points are declared by `views` (`PluginPoints.declare` in its layer); a record is `{view, title, icon?}`, with `view` required to be in the neighboring `views` of the same manifest — otherwise the plugin is `failed` with that reason, as with `results`. `icon` is a file in the plugin's `ui/`; the feed hands it out as a path inside the package, and the client resolves it against the plugin origin from the set, like view pages ([[a9714f0d]]). One `views.subscribe` feed carries views, sections, and panels: the client needs no second source and no second update order.

A section is the shared `/[project]/p/[plugin]/[view]` route with a single SvelteKit file. `SurfaceRegistry` holds a permanent part from feature declarations plus one added on the fly: `register` returns a disposer and refuses on a duplicate id or route. The `plugin` declaration with route `p` and `nested` is an umbrella: `of(routeId, params)` substitutes route parameters into `p/[plugin]/[view]` and finds the registered section, answering the umbrella without parameters or without registration. So a page at a direct URL does not depend on registration order: `SectionPage` looks at the feed itself and renders nothing before the first answer; a view stretches over the section and panel (`fill`) and learns of resizes through `host-context-changed`. A section remembers no place (`remembers: false`) and does not travel with the operator to another project (`portable`): the plugin may be off there, and switching leads home.

Registration is done by `Sections` — a project-layer service with `eager` living while the project scope lives: the native plugin window, which has no shell, needs it too, so it is not tied to chrome rendering. A warm project holds its scope in the background, so `Sections` publishes only while `ProjectFocus` says the project is current in the window, and through `PluginActions.show` — one publication per window: a new one removes the standing one, otherwise two warm projects with one plugin would make the repeated registration refuse on a duplicate id. Any set change republishes sections and palette actions in one synchronous effect flush; switching a plugin off removes the rail item and palette actions. Icons draw as masks (`PluginIcon`): rail and state colors stay shell tokens, and the file's color is unused.

A panel is the one `plugin` tab with id `<plugin>/<view>`. The view is one and declared statically, so a layout restored after reload always finds it. Its `stands` (`features/plugins/panes.ts`) decides on what the feed knows for sure: the `plugins` set holds only running plugins, and one that is starting, restarting, or crashed is absent from it while staying in `enabled`. So the tab leaves the layout when the plugin is switched off or a running plugin no longer contributes a panel, while temporary unavailability and an unloaded set (`null`) never wipe the layout; without `enabled`, a plugin restart would delete saved tabs for good.

A section or panel is opened by the operator from the palette and the rail, or by a plugin view through `tagma/open` with `{section}` or `{pane}` — only on a click inside the view and only at a target the plugin contributes: otherwise the refusal comes before the layout is touched.
