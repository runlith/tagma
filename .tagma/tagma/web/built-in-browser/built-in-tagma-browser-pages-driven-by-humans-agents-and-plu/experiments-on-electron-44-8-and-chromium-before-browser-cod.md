---
id: 01a147d6-7ef4-7c9c-9e39-fea9ce0f09a0
title: "Experiments on Electron 44.8 and Chromium before browser code: WebContentsView parking, debugger capture, element picking, focus emulation, console, dialogs, hangs, Keychain"
ord: 8
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a147b0-e165-75df-b2b0-9a0cf3ea399e
  - kind: relates
    to: 01a147e4-e266-7d95-ae42-070fbdb94d27
---
Establish by experiment the facts the [[f3ea399e|browser spec]] "Unestablished" section's decisions stand on, before desktop-host and import code. Electron 44.8.0 from the workspace, macOS, the `browser` worktree.

Experiments (each a short script in a temporary directory, not in the repository):
1. `WebContentsView` in a never-shown window: does it draw, does it yield `capturePage`, `Page.captureScreenshot`, and `Page.startScreencast` frames through `webContents.debugger`; does the page live (the same `webContents`, no reload) when `addChildView` moves it to another window; what happens to it when the window closes.
2. `Page.captureScreenshot` and `Page.printToPDF` through `webContents.debugger` on a `WebContentsView` page.
3. `Overlay.setInspectMode` → `Overlay.inspectNodeRequested` through `webContents.debugger`.
4. An unfocused page with `Emulation.setFocusEmulationEnabled`: do `Input.insertText` and `Input.dispatchKeyEvent` reach the field without stealing focus from another window.
5. Does `console.error` from page JS arrive through a single `Log.enable` without `Runtime.enable`.
6. Electron events for `alert`, `confirm`, `prompt`, and `beforeunload` (`will-prevent-unload`) on a detached `WebContentsView` page; what a human sees.
7. `unresponsive` / `responsive` on a `while(true){}` page's `webContents` with the debugger attached and detached.
8. Keychain: which process the request names and what lands in the `Chrome Safe Storage` ACL on "Always Allow" when reading through `/usr/bin/security` and through Security.framework from Bun FFI (`SecItemCopyMatching`). The experiment touches the operator's real Keychain: reading only, no "Always Allow" — read the ACL with `security dump-keychain -a` before and after on a test record created for the experiment and deleted after.
9. Chrome for Testing with `--headless=new`: does it ask the Keychain for its "Safe Storage" on macOS; does `--use-mock-keychain` work.

Done when: each experiment has a recorded outcome (what was done, what was seen, version), and the spec places the outcome changes are fixed in its parts. Outcomes are one `#research` record under [[838a9443|the research]] listing the experiments; experiment scripts are not kept, the record says so.

Done: [[bdb94d27|nine-experiment results]]; the shared spec, desktop, engine, import, and managed are fixed. No repository code changed. Left unproven: the signed Tagma release's identity and ACL, the deleted test login record's ACL after Always Allow, the second Bun window's cause, the missing second native window after a CDP answer, the first headless launch of a clean macOS account, and keeping another active window's pid.
