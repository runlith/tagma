---
id: 01a14c05-71a7-71c8-88a1-ee55f4b81c8f
title: A developer builds, signs and notarizes a self-contained Tagma release for Mac, and a distribution's publisher publishes it
ord: 28
tags: ["feature"]
fields:
  {
    "state": "partial"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/cut/release.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cut/pipeline.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cut/publish.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cut/trial.ts
---
**Value.** A developer ships a self-contained app that people can pass around and update through the same public source.

**How.** `bun run tagma:release`, its notarize and publish actions; these are developer scripts, not release-user tools. A distribution in another repository runs the same cut over its own build descriptor, which names its source roots, brand, signing, client config, feed address and publisher.

**Behaviour.** A cut is made from a clean commit and carries server, surface, runtime and needed child programs, checking for developer parts and local paths. One commit is cut for Mac with Apple silicon and for Intel: signed apps, update archives and DMGs of each architecture are built, source maps kept separately. The trial starts each architecture — Intel under Rosetta — and, with a previous cut present, moves from it through its own update. Interrupted cuts and notarization continue by repeating the same command: built and tested parts are not repeated, a send to Apple with a recorded id is not sent again, and the previous cut stands whole until the new one takes its place. Publishing completes Apple notarization and hands the descriptor's publisher the archives, DMGs and the feed continuing the previous release's feed; a repeat picks up completed steps.

**Limits.** macOS, a Developer ID identity and Apple access are required; the native helper trial needs a GUI session. The core's own builds name no publisher and no feed address, so this repository cuts and notarizes a release but does not publish it, and its releases read only the `release.feed` setting. This is a mechanism in sources, not evidence of a successful publish or a check on another machine. Windows and Linux delivery is not implemented this way.
