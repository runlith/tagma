---
id: 01a1645e-1265-7c5e-a30d-47d238ce4f43
title: Last good model catalog survives the server; a refresh failure does not switch the provider off
ord: 15
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/providers/catalogs.ts
  - kind: file
    ref: apps/tagma/server/src/providers/registry.ts
---
The async catalog belongs to providers and is read with the selected default account: sign-in, default change, manual refresh and the daily driver converge in one owner. Every server start reads each selected provider's catalog again in the background, whatever the saved copy's age, since a new build may name or list models differently; the daily refresh follows. Startup and the daily refresh read a CLI catalog after an addressed selection or a signed observation from an adapter declaring discovery. An unsigned or unreadable discovery answer does not open catalog reads. An undeclared CLI still needs sign-in through Tagma, an addressed catalog request, or use of its CLI or borrowed native model. Wire- and key-based harness readers receive credentials; the CLI reader receives the account's permitted address and the ready environment of the same owner that starts the thread. An unspecified catalog stays `null` instead of becoming a home path. The machine snapshot stores only the model descriptions and the last successful time; the server restores them before serving the window. A read or save failure stays a separate catalog state next to warnings about skipped models: earlier models stay selectable, and an adapter failure still blocks its calls.
