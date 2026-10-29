---
id: 01a12356-d940-7b73-8322-55d677741411
title: "A sender holds no more than 20 open notifications: the feed gives them in one frame with no window"
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/notify/contract/wire/notification.ts
  - kind: file
    ref: apps/tagma/server/src/notify/inbox.ts
---
The `notifications.subscribe` feed and the `all` event for push carry every open record at once, with no window or pages, and a record weighs up to ~1.2 KB (title, body, a question with four options). With no limit a plugin with a looping bug would bloat that frame and the operator's "Attention" list, and someone else's notification stream would push out the rest. Twenty is room for a bridge or a table where single records await answers at once. If more is ever needed, the limit turns into a window in the feed, not a raise.
