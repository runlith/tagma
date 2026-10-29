---
id: 01a1882b-4844-74c8-9ecd-8e2943d5f5c4
title: An app's secrets are declared at launch and handed in its env; values of the former owner kind move into the store at start
ord: 8
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a123ad-a26a-771a-b839-5773f1844d71
sources:
  - kind: file
    ref: apps/tagma/server/src/tagma-apps/secrets.ts
---
Which secrets an app declares is learned when it launches, not when contributions publish: the launch provider receives the checked manifest before the process starts and remembers the declaration at once. Otherwise an app that crashes without its secret would never show the field it is entered in. For the same reason the `secrets` point's `register` is empty: the schema checks the declaration and the launch gives it meaning. The declaration appears after the first read of an enabled app's manifest; a disabled one shows no fields.

A changed value restarts the process once through the supervisor, because the env fingerprint changes; a secret store that cannot be read refuses the launch rather than starting the process without its secrets. Uninstalling drops the app's values before it removes the installation, so a failed drop leaves the app installed and the uninstall repeatable.

Values stored under an earlier owner kind, or still in the former secret file of the data directory, move to the owner kind `tagma-apps` in the module's start step (`steps/data.ts`), before any app launches. Moving never overwrites a value already standing; the former file is read through `CredentialFile`, so a replacement interrupted before the upgrade is recovered, its values are read back from the store, and only then are the file and its lock deleted. A move that cannot complete does not stop the server: until the next start carries the values, every app that declares secrets refuses to launch, naming the former file, so no app runs without a value it held.