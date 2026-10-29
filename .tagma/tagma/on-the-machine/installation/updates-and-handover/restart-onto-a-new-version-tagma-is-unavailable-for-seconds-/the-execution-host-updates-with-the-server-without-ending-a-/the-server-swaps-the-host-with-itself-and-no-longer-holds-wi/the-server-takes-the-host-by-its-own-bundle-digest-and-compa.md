---
id: 01a129b5-8b8f-7b10-b77d-a491654a8d6a
title: The server takes the host by its own bundle digest, and compatibility reconciliation and old host-swap roads are removed
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
---
Part 1 of [[2e350fc3]]: remove `ArtifactFormats` from manifest/stamp/identityInput, `compatibility()`/spokenWire and their consumers (activation, hostArtifacts, buildArtifact, recovery, CLI, fixtures); replace `hostReplacement`/`watchReplacement` start with take by exact digest and load entry; remove `when-idle`/`force` modes, `HostOffering.when/watch`, `replace_host`, `tagma terminal replace-host`, `HOST_REPLACE_ONCE`, preflight cutover. `endByRecovery` and `tellReplaced` stay for [[a06a1a9e]]: reading its source bundle does not break. Done when the old names are gone outside the archive, a server with a matching digest and load entry takes the standing host without touching it, and narrow boot/offer/activation tests are green.
