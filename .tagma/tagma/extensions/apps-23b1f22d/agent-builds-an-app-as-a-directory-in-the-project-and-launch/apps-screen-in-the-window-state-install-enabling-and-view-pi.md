---
id: 01a14c37-8e71-7053-9adc-c10225c23522
title: "Apps screen in the window: state, install, enabling, and view pins"
ord: 1
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b09415a61526
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b098800eb2b3
---
Apps are installed only through an agent or `tagma op`; Settings → Apps shows `apps.installed` and `apps.enabled` as raw JSON. A view cannot be pinned or unpinned from the window; `pin_view` is not offered to agents.