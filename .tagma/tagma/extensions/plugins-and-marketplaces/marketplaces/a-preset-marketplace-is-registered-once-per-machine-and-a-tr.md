---
id: 01a189aa-af1f-7b34-96b9-33ec335c749f
title: A preset marketplace is registered once per machine, and a trust label comes from Tagma's registration, never from the list
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/marketplaces/contract/wire/presets.ts
  - kind: file
    ref: apps/tagma/server/src/marketplaces/layer.ts
---
`plugins.marketplacePresets` remembers every preset ever registered on the machine; the server registers only presets missing from it, so a preset the person removed is never added back, and a preset shipped later reaches an existing machine at its next start. A preset is registered without waiting for the network and fetched in the background; a failed fetch leaves it registered with no stored list and the failure on its row, and the person refreshes it.

The trust label is Tagma's own and stands on the registration. A preset carries its own — `tagma` for Tagma's marketplace, `vendor` for Anthropic's and OpenAI's — and so does a marketplace added by the exact URL of a preset; anything else is `unreviewed`. A list names itself and its owner, and neither ever grants a label, so a list calling itself `claude-plugins-official` from another address is `unreviewed`.

Marketplaces read in label order, Tagma's first, and in registration order within a label. Registration order alone would put a preset shipped later after everything a machine registered before it, Tagma's own included.
