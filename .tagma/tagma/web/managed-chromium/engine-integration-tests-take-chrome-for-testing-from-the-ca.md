---
id: 01a1482d-91a0-791c-a67f-cc979f6631b5
title: Engine integration tests take Chrome for Testing from the cache and never download it themselves
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/scripts/fetch-browser.ts
  - kind: file
    ref: apps/tagma/server/src/managed-browser/testing/cache.ts
  - kind: file
    ref: apps/tagma/server/src/managed-browser/testing/host.ts
---
The directory is `TAGMA_BROWSER_BUILDS`, by default `~/.cache/runlith/browser-builds` of the real HOME (`test/layers.ts` pins it before HOME is swapped). In tests the build HTTP client fails with a message naming the directory and the `bun apps/tagma/server/scripts/fetch-browser.ts` command: a missing binary fails the test, never skips it, and the test run needs no network. Changing `CHROME_RELEASE` requires refilling the cache.
