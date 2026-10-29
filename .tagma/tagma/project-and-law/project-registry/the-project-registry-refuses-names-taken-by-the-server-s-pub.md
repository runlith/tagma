---
id: 01a123bc-e1aa-73bf-9ff9-3830bc9d38bf
title: The project registry refuses names taken by the server's public paths
ord: 1
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1236e-0adf-7dc2-babd-bb7996c6f53e
sources:
  - kind: file
    ref: apps/tagma/server/src/projects/contract/service/names.ts
  - kind: file
    ref: apps/tagma/server/src/projects/registration.ts
---
A project name becomes the first segment of its URL, so the API and the code served before the SPA occupy that name in full. Composition hands `ReservedNames` over from the declared HTTP paths and code prefixes; `Projects.register` answers `reserved-project`, honoring the router's case-insensitivity. A registry without an HTTP binding receives an empty set, and the cross-project graph reserves its own name. Renaming through `update_project` passes the same checks as registration, and open window addresses move to the new name on the registry event.
