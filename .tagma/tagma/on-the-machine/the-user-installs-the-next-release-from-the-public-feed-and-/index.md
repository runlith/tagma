---
id: 01a14c05-71a7-71c8-88a1-ee460a9ce615
title: The user installs the next release from the public feed and picks the restart moment
ord: 13
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee476cec84de
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee4b86343018
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee4cea7d76f8
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee55f4b81c8f
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/StandingChip.svelte
  - kind: file
    ref: apps/tagma/desktop/src/quitting.ts
  - kind: file
    ref: apps/tagma/server/src/installation/operations/next.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/cli.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/runner.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/settings.ts
---
**Value.** The user gets a new release without rebuilding Tagma or hunting files by hand.

**How.** The installation chip in the status bar, Check for Updates… in the app menu, `tagma release check` and `tagma release update`, the `check_for_updates` and `install_next` operations; the `release.feed` source is set in the release build.

**Behaviour.** The server reads the public feed at start, every hour and whenever the person checks, and offers the newest release with this machine's platform archive, installing nothing on its own. On Mac the platform follows the machine's processor, so an x64 installation under Rosetta is offered the arm64 update. If the newest release has no archive for this platform, there is no offer and the state reading names the reason; an older release is not offered instead. Before the action, an offer names an earlier rollback with its recorded reason or a deliberate return from that release. On the person's action it requires the archive's exact declared size, checks its digest and admissible entries, and measures their real size before making room to extract them. Before running the installer it verifies the app signature and requires the proven manifest to match the offered release, machine platform and irreversible changes; content proof runs away from the serving loop. A release the execution host refuses stays alongside without becoming current or triggering the requested restart, and the recorded placement survives interruption of the delivering server. Otherwise it installs and restarts, or only installs when the person postpones restart; stages, bytes received, outcome and failure reason are visible. Closing the CLI does not cancel a server-side installation.

**Limits.** Feed and archive are available without an account, but agent work follows alpha access. This is one release source with no gradual rollout and no wave selection. Installation can be stopped until the requested-restart stage; once a release is selected, stopping does not return the previous choice.
