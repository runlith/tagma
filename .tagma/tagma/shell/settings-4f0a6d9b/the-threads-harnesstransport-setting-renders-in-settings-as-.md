---
id: 01a10cfb-bfb8-73c9-a069-d4293de3a546
title: "The `threads.harnessTransport` setting renders in Settings as a text field with `[object Object]`: an object key has no control"
ord: 6
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a10ce2-7e0b-7e5a-a1d0-85a421e1c72d
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/settings/SettingControl.svelte
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/settings.ts
---
`threads.harnessTransport` is declared as an object schema "vendor → terminal | acp" with no `control`. `SettingControl.svelte` drops such a value into its last branch and renders an `Input` with `String(shown)` — `[object Object]`. Editing the field writes a string the server rejects. The key shows in the Threads section.

A control is needed: per vendor a choice of `terminal` / `acp` (or "default"), for example through `rows` or a new key control kind. Done when the Threads section shows transport per vendor, and writing one vendor changes only it.
