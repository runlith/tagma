---
id: 01a15b2c-6eb5-7ad6-ba00-3bd37cb3c1cf
title: Changing the app mechanism in the same change updates the `apps` skill
ord: 6
tags: ["rule"]
fields:
  {
    "delivery": "code"
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/plugins
  - kind: dir
    ref: apps/tagma/server/src/secrets
  - kind: dir
    ref: apps/tagma/server/src/plugins
  - kind: dir
    ref: apps/tagma/server/src/views
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/viewSpeech.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/views/params.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/views/ViewBridge.ts
  - kind: file
    ref: apps/tagma/server/src/composition/http/operations.ts
  - kind: file
    ref: apps/tagma/server/src/composition/outcomes.ts
  - kind: file
    ref: apps/tagma/server/src/composition/ticks.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/callers.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/declared/plugins.ts
  - kind: file
    ref: apps/tagma/server/src/notify/contract/wire/notification.ts
  - kind: file
    ref: apps/tagma/server/src/schedule/timetable.ts
  - kind: file
    ref: apps/tagma/server/src/speech/contract/wire/listening.ts
  - kind: file
    ref: apps/tagma/server/src/speech/contract/wire/view.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/operations/catalog.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/operations/pins.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/operations/routes.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/operations/turns.ts
  - kind: file
    ref: apps/tagma/server/src/threads/harness/pluginEndings.ts
  - kind: file
    ref: apps/tagma/server/src/threads/operations/acts.ts
  - kind: file
    ref: apps/tagma/server/src/threads/pinOffers.ts
  - kind: file
    ref: packages/mcp/src/mcpCallerMeta.ts
  - kind: file
    ref: packages/mcp/src/McpSession.ts
---
Covers everything an app author sees: the manifest and its points, the process and the caller in `_meta` of its calls, the view bridge and `tagma/*` methods, the operations open to the app process, app threads and agents, secrets, schedules, and notifications. The skill describes the mechanism as it stands now — without history and without what is gone.