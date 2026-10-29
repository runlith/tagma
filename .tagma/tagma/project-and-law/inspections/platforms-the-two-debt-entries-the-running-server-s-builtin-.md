---
id: 01a0eed5-ade1-7781-ad0e-238582c16049
title: "platforms: the two debt entries the running server's builtin still reports retire once it runs 8b0e3abc22"
ord: 12
tags: ["task"]
fields:
  {
    "status": "done"
  }
---
`@runlith/executions/protocol/*.test [bun] -> unresolved` reads the manifest's `null` exclusion as a door, and `SettingsPage.svelte [browser] -> unresolved { eager: true }` reads a glob's load-only options as unresolved. 8b0e3abc22 fixes both in `platforms/doors.ts` and code-facts' JS adapter (version 7); the server that enforced [[50520d64]] runs an earlier build, so both were recorded as debt owned here.

Done when the server runs 8b0e3abc22 or later and a re-measure of [[50520d64]] no longer finds either entry.
