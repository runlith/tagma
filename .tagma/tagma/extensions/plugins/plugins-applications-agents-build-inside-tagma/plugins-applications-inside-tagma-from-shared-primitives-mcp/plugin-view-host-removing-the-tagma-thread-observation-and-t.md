---
id: 01a123e7-eed2-7633-aba7-28d4a5059343
title: "Plugin view host: removing the tagma/thread observation and the real height limit of the pinned region in context"
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1231d-b9cc-7eb6-be22-add828aa44c4",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a123c5-f783-7f18-b0c7-8ce2b7d795c0
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
---
The poker-table acceptance with a view (b7d795c0, `38196f9e52`) found two gaps in the plugin view host. (1) The `tagma/thread` observation cannot be removed: each lives until the mount ends, and with player-thread rotation the pinned table accumulates observations as places × deals / rotation period. A way to remove a thread observation is needed. (2) The host reports `containerDimensions.maxHeight` to the pinned view as 0.8 of the window height, although the pin region is limited to a third: the view does not know its real limit. Done when a host test shows: a removed thread observation no longer delivers notifications and frees the subscription; the pinned view receives the region limit, not the window's, plus an update on resize.
