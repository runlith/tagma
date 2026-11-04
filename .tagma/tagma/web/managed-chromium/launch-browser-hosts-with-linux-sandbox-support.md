---
id: 01a1a825-a4c0-7fe7-85c3-122f1d338fe3
title: Launch browser hosts with Linux sandbox support
ord: 15
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19eb2-4a56-79d0-9dbd-af67ec98a662",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a1488c-954c-76bc-bfcd-42d64103030b
  - kind: relates
    to: 01a1a76d-608f-76fe-a67f-8d9221d844d1
---
Put Linux browser launch prerequisites behind the platform adapter, extending the existing platform-boundary work. Preserve Chromium's sandbox: use an available supported namespace sandbox or a correctly installed helper, including an explicit `CHROME_DEVEL_SANDBOX` supplied by the user; do not switch off the sandbox or weaken system security. [Chromium's AppArmor guidance](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md) documents the installed Chrome helper at `/opt/google/chrome/chrome-sandbox` as a supported alternative on restricted Ubuntu. A missing helper, missing native library or missing display is a typed refusal carrying the browser's diagnostic and an actionable way out. Desktop packaging/launch and the test fixture must use the same Linux environment contract, rather than copying environment policy into tests.

Done when all nine migrated managed-browser, desktop-browser and page-render e2e files pass on Linux with sandboxing preserved, and a machine without the required capability refuses explicitly rather than hanging or claiming an unknown page action. The Linux runner may provision a display, which its noninteractive image lacks; the product still diagnoses a missing display on a user's machine. Do not change the workflow files owned by the e2e-lane agent in this work.

**Outcome.** Linux CI run 41932088980 on 40778b6a6 passed all nine files, 84 pass and 0 fail, with Chromium's sandbox kept: CI provisions root-owned mode-4755 helpers (`CHROME_DEVEL_SANDBOX` and Electron's adjacent `chrome-sandbox`). The one headed scenario (shown installed Chrome) was not run. Once launch worked, the Linux runs exposed product defects, each fixed at its owner: capture used a hidden CDP target that never paints on Aura; a desktop page parked in a never-shown window stops drawing after its first frame; Chromium's POSIX CPU throttler spins, so a slowed page spent the hang budget; managed `open` answered before its document committed; a screencast copy could read the selection before a posted select-all landed; a session ending with its closing target re-placed a destroyed view. None of these was rerun on macOS after the change.
