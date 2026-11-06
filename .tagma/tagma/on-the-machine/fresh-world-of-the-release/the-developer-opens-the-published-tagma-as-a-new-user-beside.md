---
id: 01a1b1e2-b996-7bae-b2b6-a4677aee640f
title: The developer opens the published Tagma as a new user beside Tagma Dev and starts it over in one act
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a1b1c0-98e5-732c-b08b-923bf6325236
  - kind: supersedes
    to: 01a14c05-71a7-71c8-88a1-ee4e7b385f80
sources:
  - kind: dir
    ref: apps/tagma/server/src/fresh-world
  - kind: file
    ref: apps/tagma/server/src/mac-release/fresh.ts
  - kind: file
    ref: apps/tagma/desktop/src/freshWorld.ts
---
**Value.** Tagma's developer sees, at any moment and without stopping the agents and terminals of Tagma Dev, exactly what a new user gets from the published release, and starts that over from nothing whenever a first launch is to be seen again.

**How.** Open Fresh Tagma and Start Fresh Tagma Over in Tagma Dev's View menu; `tagma-dev fresh` with `--over`, `--release`, `--from` and `--status`.

**Behaviour.** The release runs with a home of its own in `~/.tagma-fresh`, so its data, keychain, junction, shell profile and harness configs belong to nobody else and Tagma Dev runs untouched beside it. The release comes from the feed the developer build's distribution names, the newest unless one is named, or from a local app, disk image or release archive; a release once taken is kept, so starting over downloads nothing. Starting over quits the world, ends every process left under its root, resets what macOS keeps for its bundle, removes everything it wrote and opens the release on its first launch.

**Limits.** It shows a new user on the developer's Mac, not a new Mac: the machine's tools, Command Line Tools among them, stay visible, and Gatekeeper's first open and the move to Applications are not exercised. Only the developer build carries it, and one fresh world stands at a time. Tagma.app opened from Finder or the Dock starts on the account's own home, as any app does.
