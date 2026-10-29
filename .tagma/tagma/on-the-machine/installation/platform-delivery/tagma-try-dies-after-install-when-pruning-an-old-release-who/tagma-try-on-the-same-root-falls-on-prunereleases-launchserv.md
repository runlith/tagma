---
id: 01a14ab5-42ad-7502-b044-46bb224a3121
title: "\"tagma:try on the same root falls on pruneReleases: LaunchServices -10814\""
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "After build (~40 s) pruneReleases → forgetBundles throws: LaunchServices kept 7 applications of …/20261015T185515053Z (−10814 from spotlight); try exits with code 1. Workaround is a new --root.",
    "command": "bun run tagma:try (default root ~/.tagma-dev-try, holding past releases), 2026-10-17 16:31",
    "expected": "The build lands, old releases are cleaned, the server comes up."
  }
---
Filed from project `runlith`.

After build (~40 s) pruneReleases → forgetBundles throws: LaunchServices kept 7 applications of …/20261015T185515053Z (−10814 from spotlight); try exits with code 1. Workaround is a new --root.
