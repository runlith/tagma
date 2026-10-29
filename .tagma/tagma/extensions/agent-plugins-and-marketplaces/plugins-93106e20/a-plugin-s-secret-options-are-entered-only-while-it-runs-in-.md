---
id: 01a1892f-b0cb-7c1f-bedc-ad18a458892e
title: A plugin's secret options are entered only while it runs in the project, because the key store's plugin holders are the plugins enabled there
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugins/PluginCard.svelte
  - kind: file
    ref: apps/tagma/server/src/plugins/enabled.ts
---
The `plugins` secret owner answers a holder per plugin enabled in the asking project, so `read_secrets` and `set_secret` know no holder for a plugin installed but off there. The card then lists the plugin's secret options with whether each is set, read from the plugin row, and offers no field: a field would only meet a refusal. Plain options have no such bound — `plugins.options` is a machine setting written for any installed plugin — and a plain option's declared default travels on the row (`fallback`) so the card shows the value in force, a boolean's switch included; a secret option's default is never sent.