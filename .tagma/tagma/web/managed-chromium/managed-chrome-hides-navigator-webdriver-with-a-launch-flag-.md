---
id: 01a1a805-02b1-737b-a12b-29b71e27f3f0
title: Managed Chrome hides navigator.webdriver with a launch flag, because the debugging pipe itself turns it on
ord: 14
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/managed-browser/builds/chrome.ts
---
Chrome turns `navigator.webdriver` on for a process started to be driven, whatever its window: measured on Google Chrome 156 (macOS, windowed, fresh profile) it is true with `--remote-debugging-pipe`, `--remote-debugging-port=0` or `--enable-automation`, and false with no flags or with `--remote-debugging-port` on a fixed port. The managed host needs the pipe — a port would let any local process drive a browser holding the user's sessions — so every launch adds `--disable-blink-features=AutomationControlled`, which turns the property off while the pipe stays. Without it every site reads the managed browser as automated: bot.sannysoft.com fails its WebDriver check, and Google refuses sign-in.

Chrome answers that flag with an "unsupported command-line flag" infobar, which takes 56 px from the page: `outerHeight - innerHeight` reads 143 instead of 87, so a page can see it. `--test-type` suppresses the bad-flags infobar and leaves `navigator.webdriver` false; pages the host opens each in a new window carried no infobar even without it, only Chrome's startup window did. Which other behaviours `--test-type` changes in Chrome was not read; the three checks below see no difference with it.

With the flag and a window, the same Chrome driven over CDP passes bot.sannysoft.com, BrowserScan (CDP included, with and without `Runtime.enable`) and CreepJS (0% headless, 0% stealth), and Google answers account lookup rather than refusing the browser. That is one sample on one machine; other traces of CDP control are not covered by these checks.
