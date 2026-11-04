---
id: 01a1a76d-608f-76fe-a67f-8d9221d844d1
title: Managed Chromium names three operating systems in its build lookup, unpack, user agent and keychain flags
ord: 13
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0eaa1-2c4c-7cbd-9014-d7496f758080
  - kind: relates
    to: 01a19ec6-f467-787a-a87e-89cb77c57d56
sources:
  - kind: file
    ref: apps/tagma/server/src/managed-browser/builds/chrome.ts
  - kind: file
    ref: apps/tagma/server/src/managed-browser/builds/chromeForTesting.ts
  - kind: file
    ref: apps/tagma/server/src/managed-browser/builds/installedChrome.ts
  - kind: file
    ref: packages/chrome-for-testing/src/build.ts
---
The build providers hold per-OS knowledge in the shared module: where a user's Chrome lives, how to unpack a Chrome for Testing archive, the user-agent platform token and the secret-store flag.

Read at ee24295b8e:
- `builds/installedChrome.ts:8-21` candidate paths for darwin, linux and win32; `:50` the release is read by running `--version` except on win32 where it is read from a sibling directory name.
- `builds/chromeForTesting.ts:24,118` platform from `process.platform`; `:90` `ditto` on darwin, `unzip` elsewhere.
- `builds/chrome.ts:13-16,34` `--use-mock-keychain` on darwin, `--password-store=basic` on linux; `:18-22,25` user-agent platform token by OS.

Unclear:
- `packages/chrome-for-testing/src/build.ts:8-13,16-19` maps `(os, arch)` to Google's build name and lays out the macOS app bundle against `chrome.exe`. It is a table of the vendor's published artifacts rather than logic, but it enumerates operating systems in a shared package; the server's `chromeForTesting.ts` and the module of that package depend on it.

Done when installed-browser discovery, archive unpacking, the user-agent token and the secret-store flag are fields of a per-OS adapter composition supplies, and the module's OS-independent tests pass on a Linux runner.