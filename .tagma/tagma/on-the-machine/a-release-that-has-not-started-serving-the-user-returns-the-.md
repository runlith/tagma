---
id: 01a14c05-71a7-71c8-88a1-ee48e7ff5201
title: A release that has not started serving the user returns the previous installation and data on its own
ord: 15
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/desktop/src/SurfaceLoader.ts
  - kind: file
    ref: apps/tagma/server/src/composition/attempt.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/trial.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/install.ts
---
**Value.** A failed move to a new release must not take the user's working Tagma and its data away.

**How.** An automatic install attempt between `install-from`, `serve` and the desktop loader; retry and report-saving in the window.

**Behaviour.** Before first opening the stores, the new release saves copies of the databases, and the move counts as successful only after opening the local door. A failure before it restores the copies and the previous choice; an interrupted start is picked up by the next launch. If the data could not be returned, the new release stays selected and first repeats the return instead of opening the data for work. The window reports the outcome and does not re-impose an already failed attempt.

**Limits.** The guard covers a move that has not yet started serving the user. After an open door, data is not returned automatically. A first release with no previous installation cannot bring back a previous program. A disk fault may leave the return unfinished; the window names that separately from a plain rollback.
