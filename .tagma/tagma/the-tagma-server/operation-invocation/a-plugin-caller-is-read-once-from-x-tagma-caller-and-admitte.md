---
id: 01a1b194-1562-793c-9f93-a3f38d245faf
title: A plugin caller is read once from `x-tagma-caller` and admitted only where the plugin runs
ord: 14
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/plugin.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/identity.ts
---
`identityOf` reads the header once; a name of the `plugin:<id>` form gives the `external` actor its `plugin`, any other name stays attributed and nothing more. Every reader takes `actor.plugin`; no operation parses the prefix again. It is a field, not an actor kind: a plugin and another outside program pass the same `external` gate and differ only in the checks below, so a kind would add an identical case to every switch on `actor.kind`.

After the call's place is settled, a plugin's call placed in a project refuses `plugin-not-enabled` unless the plugin runs there, and one with no project unless `plugin-host` holds a slot for it. The checks read the held `plugins.enabled`/`plugins.disabled` values and the supervisor's slots in memory, never a plugin's directory, so admission costs the same whatever is installed.

A thread a plugin creates is bound to it by Tagma: `create_thread` writes `bindings.plugin` from the caller and refuses `binding-reserved` for a `plugin` key in anyone's input. Run-end delivery, questions and the own-thread acts all rest on that one writer of the binding.