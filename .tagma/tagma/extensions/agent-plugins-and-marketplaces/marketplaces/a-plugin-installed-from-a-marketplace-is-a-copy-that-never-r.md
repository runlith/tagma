---
id: 01a189aa-af19-7592-ac8c-2de1f6b3083a
title: A plugin installed from a marketplace is a copy that never reads its marketplace again; only update_plugin moves it
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/marketplaces/operations.ts
  - kind: file
    ref: apps/tagma/server/src/marketplaces/layer.ts
---
A marketplace's list is a moving target: its clone is replaced on every refresh and deleted with the marketplace, and an unpinned entry resolves to whatever its repository serves at the time. If an installed plugin read from the clone, or followed its entry on refresh, the code that runs as the operator would change without the consent installing asked. So an entry is always copied into the plugin's own directory, the install records the entry's identity and the manifest it declared, and only `update_plugin` — which prepares the entry anew from the stored list and asks consent for that revision — moves the plugin. The update installs under the same lock as every install and refuses `plugin-not-installed` when the plugin was uninstalled while its consent was pending, so an approved update never installs a removed plugin again. A plugin whose marketplace was removed keeps working and answers `marketplace-gone` to an update; one whose entry left the list answers `marketplace-entry-unknown`.
