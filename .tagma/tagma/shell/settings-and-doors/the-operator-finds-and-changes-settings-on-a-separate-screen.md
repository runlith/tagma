---
id: 01a14c05-9e8f-7c75-a633-b2a2b526a4f0
title: The operator finds and changes settings on a separate screen with a layer choice and an explanation of the value
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-76f5-7c7d-bd06-8e7f03fd84a3
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a10e594302
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/Settings.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/settings/SettingControl.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/settings/SettingRow.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/settings/SettingsCatalog.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/settings/SettingsPage.svelte
---
**Value.** The operator finds a setting by meaning or key, changes it on the needed layer, and sees why exactly this value shows.

**How.** Settings from the rail, the app menu, the settings chord or a palette hit; a direct link may unfold a specific key.

**Behaviour.** Sections group in their own collapsible column; the filter searches sections and keys. Content scrolls separately, the header holds the layer choice. A row shows its own and inherited values, author, reset, overlap by another layer, and write refusal. Stock controls come from the catalog; owners add special sections. The last section and layer are remembered per device, a narrow window moves the section choice into the menu.

**Limits.** The catalog resolves through the registered project, even for shared settings; with no project the page offers to register one. System keys the machine itself writes are not shown as plain rows, and managed keys point to their act.
