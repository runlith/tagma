---
id: 01a1a825-a4c0-7fe7-85c3-122f1d338fe3
title: Launch browser hosts with Linux sandbox support
ord: 15
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19eb2-4a56-79d0-9dbd-af67ec98a662",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a1488c-954c-76bc-bfcd-42d64103030b
  - kind: relates
    to: 01a1a76d-608f-76fe-a67f-8d9221d844d1
---
Ubuntu CI run 41895806886 on dcd1721ea aborts Electron before attachment: its own stderr says `FATAL:sandbox/linux/suid/client/setuid_sandbox_host.cc:166` and requires the bundled `chrome-sandbox` to be root-owned with mode 4755. `desktop-browser/cookies`, `engine` and both restart scenarios all launch that same executable. The restart fixture awaited only attachment, so process exit could never settle its wait; that wait is corrected separately. Diagnostic-bearing CI run 41903244612 on 18457469837a312a821d752e6c4089dbe2258bb5 proves managed Chromium aborts in `zygote_host_impl_linux.cc:128`: `No usable sandbox!`, naming AppArmor restrictions on unprivileged user namespaces. The nine migrated files all still fail at startup. The corrected restart waits now expose Electron's same sandbox error in 1,478 ms and 445 ms instead of reaching the hang guard. Commits 18457469837a312a821d752e6c4089dbe2258bb5 and 5a20c6f0357fd82f67911926bf87b09238d351c8 carry diagnostics, exit-aware waits and release of a completed startup before a capture fallback resumes; targeted capture CI 41904521959 is pending. Linux sandbox provisioning remains open.

Put Linux browser launch prerequisites behind the platform adapter, extending the existing platform-boundary work. Preserve Chromium's sandbox: use an available supported namespace sandbox or a correctly installed helper, including an explicit `CHROME_DEVEL_SANDBOX` supplied by the user; do not switch off the sandbox or weaken system security. [Chromium's AppArmor guidance](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md) documents the installed Chrome helper at `/opt/google/chrome/chrome-sandbox` as a supported alternative on restricted Ubuntu. A missing helper, missing native library or missing display is a typed refusal carrying the browser's diagnostic and an actionable way out. Desktop packaging/launch and the test fixture must use the same Linux environment contract, rather than copying environment policy into tests.

Done when all nine migrated managed-browser, desktop-browser and page-render e2e files pass on Linux with sandboxing preserved, and a machine without the required capability refuses explicitly rather than hanging or claiming an unknown page action. The Linux runner may provision a display, which its noninteractive image lacks; the product still diagnoses a missing display on a user's machine. Do not change the workflow files owned by the e2e-lane agent in this work.
