---
id: 01a14849-e740-7a4d-8bcf-f2aca57c9a7c
title: "\"tagma:try falls on the third start of the same root: pruneReleases → forgetBundles throws on lsregister -10814\""
ord: 16
tags: ["reflection"]
fields:
  {
    "actual": "The process exits with code 1: \"LaunchServices kept 7 applications of …/rl-try/install/20261017T045903394Z: failed to scan …/Tagma Dev.app: -10814 from spotlight\" (mac-applications/placement.ts:134 forgetBundles ← platform/lock/directoryLease.ts:26 removeUnleased ← installation/closure/leases.ts:62 pruneReleases ← installation/cut/release.ts:619). Workaround: a new try root.",
    "command": "bun run tagma:try --root $T/rl-try --port 48731 --no-project (third start of the same root after two stops)",
    "expected": "The server starts; a LaunchServices refusal to forget an already missing/unindexed bundle never blocks startup"
  }
---
Filed from project `runlith`.

The root lies in $TMPDIR (/var/folders/...), which Spotlight never indexes; lsregister -u answers -10814 (kLSApplicationNotFoundErr). Cost: one lost start and a move to a new root.
