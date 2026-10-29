---
id: 01a14bc0-76e5-78af-8421-e72bafcb3305
title: Phone pairs to the server by code or QR and is removed with one button
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-76d6-793a-939b-838f9b8c75ed
  - kind: relates
    to: 01a14bc0-76f5-7c7d-bd06-8e7f03fd84a3
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/admission.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/devices/DeviceRow.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/devices/Pair.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/devices/PairForm.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/devices/Unpaired.svelte
  - kind: file
    ref: apps/tagma/server/src/remote/contract/wire/access.ts
  - kind: file
    ref: apps/tagma/server/src/remote/contract/wire/operations.ts
  - kind: file
    ref: apps/tagma/server/src/remote/keeper.ts
  - kind: file
    ref: apps/tagma/server/src/remote/naming.ts
---
**Value.** The operator grants his phone access to the server with one QR scan and closes the door to a lost device just as simply.

**How.** On the machine Settings → Phone & devices shows a QR and code (`create_pairing`); on the phone the camera opens the pairing page, or the code is typed by hand. List and removal — `list_devices`, `revoke_device`.

**Behaviour.**
- The code is short-lived and one per server; a new one arrives after pairing.
- Pairing is long-lived and is renewed with every login from the device. A paired phone is offered to install Tagma as an app.
- The list shows device name, when it was seen, and whether notices are on. Removal tears the device's connections down at once, and it sees the pairing page again.

**Limits.** Frequent code guessing is throttled by the server. The code lives in memory only: after a server restart a new one is needed.
