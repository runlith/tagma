---
id: 01a156e3-f5fe-7d60-82e9-534685410aa8
title: A beside installation leaves project integrations to the main Tagma instance
ord: 7
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/installs/upgrade.ts
    symbol: declaredForLaunch
  - kind: symbol
    ref: apps/tagma/server/src/installation/contract/wire/beside.ts
    symbol: besideEnv
  - kind: symbol
    ref: apps/tagma/server/src/installation/contract/wire/junction.ts
    symbol: integratesProjects
---
A trial launch declares beside mode in the installation environment and keeps it in the launcher: automatic updates of law and checkout harness configs, including the declaration before CLI launch, are skipped at the record's owner. The mode does not depend on HOME or the root location, because a separate instance may register the same checkout as the main Tagma.
