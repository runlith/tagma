---
id: 01a174a1-13c6-7008-b4af-bd594ca65e0d
title: "The Tagma app obeys the same law as the server: every part of it is a module with a card, the module rule judges imports, no cycles"
ord: 60
tags: ["rule"]
edges:
  - kind: relates
    to: 01a0eed5-adb6-7d6f-971c-a67a083d37f1
sources:
  - kind: dir
    ref: apps/tagma/app
---
Covers `apps/tagma/app`. An inspection that judges server code judges app code too, where its subject exists in the app. Only inspections of a subject the app has no counterpart for do not carry over: server Effect services, migrations, server doors. A new app area appears together with its own `#module` card.
