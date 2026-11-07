---
id: 01a1892f-b0cb-7c1f-bedc-ad18a458892e
title: "A plugin's secret options are entered only where it is a key-store holder: where it runs, or anywhere for a plugin with a provider part"
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/plugins/enabled.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugins/PluginPage.svelte
---
The `plugins` secret owner answers a holder per plugin running in the asking project and per installed plugin with a provider part, wherever it runs, since providers stand on the whole machine; a plugin turned off on the machine holds nothing. `read_secrets` and `set_secret` know no other holder, so the card offers secret fields only for a holder and otherwise says when they can be entered: a field would only meet a refusal. Plain options have no such bound — `plugins.options` is a machine setting written for any installed plugin — and a plain option's declared default travels on the row (`fallback`) so the card shows the value in force, a boolean's switch included; a secret option's default is never sent.