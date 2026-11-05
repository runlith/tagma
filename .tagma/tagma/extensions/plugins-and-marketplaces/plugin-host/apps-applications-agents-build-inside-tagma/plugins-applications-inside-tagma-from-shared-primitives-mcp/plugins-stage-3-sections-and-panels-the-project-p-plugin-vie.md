---
id: 01a123b1-a094-72bd-b4ab-f761e2355ba2
title: "Plugins, stage 3: sections and panels — the /[project]/p/[plugin]/[view] route and live plugin-section registration"
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a123b1-e4fa-70e2-a55d-2416fa22ef2f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
---
The spec's “Contribution points by stage” section → “Plugin section”: a shared route `/[project]/p/[plugin]/[view]` and live section registration; the icon is passed as a URL, not a Svelte component; the `surfaces` (section) and `panes` (panel) points are declared by their owners through `PluginPoints.declare`. This is the work [[30b488ab]] directly hands to the plugins spec. The section's view gets the same bridge and extensions.

Done when a test plugin with a section and a panel shows: the section appears in the navigation of the project where the plugin is enabled, opens by direct URL and recovers after page reload; disabling the plugin removes the section and panel; on desktop and web.
