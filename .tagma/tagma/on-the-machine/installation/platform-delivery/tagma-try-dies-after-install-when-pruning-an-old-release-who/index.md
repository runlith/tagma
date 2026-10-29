---
id: 01a1489a-85ce-7ad8-bab3-c8c0b1c9481a
title: tagma:try dies after install when pruning an old release whose LaunchServices unregister fails
ord: 3
tags: ["reflection"]
fields:
  {
    "actual": "forgetBundles throws \"LaunchServices kept 7 applications of …/install/20261017T061538831Z: failed to scan … -10814 from spotlight\" from pruneReleases (release.ts:619) and the whole try exits 1 after ~32 s of building; the instance never starts. Workaround: a fresh root.",
    "command": "bun run --cwd apps/tagma/server try --root /var/folders/.../T/tagma-try-managed --port 4815 (second release into the same root)",
    "expected": "The new release installs and serves; pruning an older release that LaunchServices cannot forget is reported and left for later."
  }
---
Filed from project `runlith`.

Stack: mac-applications/placement.ts:134 forgetBundles ← platform/lock/directoryLease.ts:26 removeUnleased ← installation/closure/leases.ts:62 pruneReleases ← installation/cut/release.ts:619. Pruning is cleanup of what is no longer needed; its failure should not fail the release that just landed.