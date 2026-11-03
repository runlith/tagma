---
id: 01a1373c-736f-7a25-8b32-081b75de56d3
title: The active server lock is taken after the data directory lock and released before it
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/junction.ts
  - kind: file
    ref: apps/tagma/server/src/installation/setup/active.ts
  - kind: file
    ref: apps/tagma/server/src/platform/lock/recorded.ts
---
`active.lock` at the junction (`~/Library/Application Support/Tagma/`) is one per account for both channels, `server.lock` belongs to each data directory. The successor on restart waits for the predecessor's `server.lock` (`standBy`) and only then takes `active.lock`. So the predecessor releases `active.lock` before `server.lock`: in the reverse order the successor would get `channel-active` from its own predecessor.

`active.json` is published through rename under the lock. A generation-aware server retains its record across release so Stop and Switch can find its cancellable handover while neither generation holds `active.lock`; the retained record does not itself prove that a server is active. The window asks its carried CLI for the held lock and verified process state. Native birth witnesses prevent a reused PID from being signalled as an old generation's member; issued records without them require proof from the active lock file, and an unknown automatic return yields an unproven stop.
