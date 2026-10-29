---
id: 01a14c05-71a7-71c8-88a1-ee5634a5ce5a
title: Installed releases and the launcher remove separately from the user's data and app
ord: 29
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee45adeff637
sources:
  - kind: file
    ref: apps/tagma/server/src/release-channel/cli.ts
---
**Value.** The user can remove installed releases and the CLI while keeping accumulated work for a later installation.

**How.** `tagma release remove` in the release build.

**Behaviour.** Removal demands a stopped server and no window holding the release. The installations directory, launcher and temporary update place are removed. The result enumerates what was removed and separately names the data kept.

**Limits.** Data, account records and the app where the person keeps it stay. This is not a cloud-account removal and not a full Tagma reset. There is no removal button in the app; the act is reached via CLI.
