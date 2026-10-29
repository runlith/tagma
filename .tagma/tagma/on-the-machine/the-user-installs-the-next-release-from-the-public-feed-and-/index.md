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
    ref: apps/tagma/server/src/installation/operations/next.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/cli.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/runner.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/settings.ts
---
**Value.** The user gets a new release without rebuilding Tagma or hunting files by hand.

**How.** The installation chip in the status bar, `tagma release update`, the `install_next` operation; the `release.feed` source is set in the release build.

**Behaviour.** The server reads the public feed at start and periodically, and offers the newest release with this machine's platform archive, installing nothing on its own. On Mac the platform follows the machine's processor, so an x64 installation under Rosetta is offered the arm64 update. If the newest release has no archive for this platform, there is no offer and the state reading names the reason; an older release is not offered instead. On the person's action it downloads the archive, checks the digest, the admissibility of its contents and the app signature, installs it alongside and then restarts. It can only install, postponing the restart; stages, bytes received, outcome and failure reason are visible. Closing the CLI does not cancel a server-side installation.

**Limits.** Feed and archive are available without an account, but agent work follows alpha access. This is one release source with no gradual rollout and no wave selection. Installation can be stopped until the requested-restart stage; once a release is selected, stopping does not return the previous choice. An intersecting irreversible change is reported before installation.
