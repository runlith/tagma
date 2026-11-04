---
id: 01a18382-34c3-790e-8309-96341a59ed27
title: Chromium crash data, temporary files and detached handlers belong to the browser world's home
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/e2e/src/engines.ts
---
Chrome on macOS chooses its crash database from the default user data location before parsing the profile override. The fixture gives the child process a world-owned crash directory through `BREAKPAD_DUMP_LOCATION`; its detached handlers then name that home, so the existing testbed claim and reaper own them as well as the browser. A profile override alone leaves those handlers outside the world and writes crash state into the person's real home.

The browser also takes a `TMPDIR` inside that home. Testbed points `TMPDIR` at each file's root and removes the root when the file ends, while a shared browser serves later files; Chrome on Linux creates its shared memory under `TMPDIR` and aborts once that directory is gone (CI 41934630019, `terminal.e2e.ts`).