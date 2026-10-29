---
id: 01a1882b-4844-74c8-9ecd-8e2943d5f5c4
title: An app's secrets are declared at launch, handed in its env, and moved once from plugin-secrets.json
ord: 8
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a123ad-a26a-771a-b839-5773f1844d71
sources:
  - kind: file
    ref: apps/tagma/server/src/plugins/secrets.ts
---
Which secrets an app declares is learned when it launches, not when contributions publish: the launch provider receives the checked manifest before the process starts and remembers the declaration at once. Otherwise an app that crashes without its secret would never show the field it is entered in. For the same reason the `secrets` point's `register` is empty: the schema checks the declaration and the launch gives it meaning. The declaration appears after the first read of an enabled app's manifest; a disabled one shows no fields.

A changed value restarts the process once through the supervisor, because the env fingerprint changes; a secret store that cannot be read refuses the launch rather than starting the process without its secrets. Uninstalling drops the app's values.

Values kept in the former `plugin-secrets.json` move into the secret store at the first launch or secret read after an upgrade: they are adopted without overwriting a value already standing, each is read back, and only then are the old file and its lock deleted. A move that cannot complete refuses that launch or read and is tried again on the next one, so no value is lost and no app starts without one.
