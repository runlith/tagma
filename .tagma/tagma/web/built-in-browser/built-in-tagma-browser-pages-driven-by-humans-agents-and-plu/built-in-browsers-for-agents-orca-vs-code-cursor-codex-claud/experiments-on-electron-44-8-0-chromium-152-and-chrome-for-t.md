---
id: 01a147e4-e266-7d95-ae42-070fbdb94d27
title: "Experiments on Electron 44.8.0, Chromium 152, and Chrome for Testing 149: parking, CDP, input, dialogs, hangs, and Keychain"
ord: 7
tags: ["research"]
fields:
  {
    "source": {
      "name": "Measurements of Electron 44.8.0 / Chromium 152.0.7977.167, Bun 1.4.3, and Google Chrome for Testing 149.0.7827.55 on macOS arm64, 2026-10-17",
      "ref": "node_modules/.bun/electron@44.8.0/node_modules/electron; ~/Library/Caches/ms-playwright/chromium-1228"
    }
  }
---
Experiments of 2026-10-17 on macOS 26.0.1 (Darwin 25.0.0), arm64, Electron 44.8.0 / Chromium 152.0.7977.167 / Node 24.22.0 and Bun 1.4.3. Secondary target — installed Google Chrome for Testing 149.0.7827.55 from the Playwright cache. This is one sample of one machine; the installed Keychain already holds the user's logins. No repo code was changed. Scripts ran from a temporary scratch outside the repo; scripts, screenshots, and generated profiles were deleted after the experiments. This record alone cannot reproduce the experiments. Raw responses stand in the tool records of the [[01a147d6-ffd3-7256-8a42-fb1dede59011|experiment thread]].

### 1. Parking, frames, and page life

A `WebContentsView` with `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`, `backgroundThrottling:false` was added to a `BrowserWindow({show:false})` that had never been shown before capture. The process also carried `--disable-backgrounding-occluded-windows`. A local page changed an element's opacity every 100 ms. At viewport 600×400 and screen scale 2, native `capturePage` and CDP `Page.captureScreenshot` returned non-empty 1200×800 images with the expected colored content. `Page.startScreencast` produced ten JPEG frames over a one-second observation window; each was confirmed with `Page.screencastFrameAck`.

On the first launch, native `capturePage` right after load refused with `Current display surface not available for capture`; on later launches it worked, including after frames arrived. This is no proof that parking must be shown: a hidden window paints, but finished loading alone does not yet guarantee a ready surface. An attempt with a window shown off-screen was clamped by macOS from coordinates −10000 into the visible area (0, 34); it is no confirmed replacement for hidden parking.

After `removeChildView` / `addChildView` between windows, the `webContents` id, a random JS token, and a load counter of 1 survived. After `BrowserWindow.destroy()`, the page's `webContents.isDestroyed()` stayed false; it could be re-added to parking with the same JS token read back. So main itself closes pages and moves them when their window closes.

### 2. Screenshot and PDF via debugger

`Page.captureScreenshot` via `webContents.debugger` works on a `WebContentsView` page. `Page.printToPDF` refuses with the exact message `'Page.printToPDF' wasn't found`. Native `webContents.printToPDF({printBackground:true})` on the same hidden page returned 8822 bytes with a `%PDF-1.4` header. PDF needs a separate `PageHost` action: Electron executes it natively, managed Chromium — via CDP. The refusal belongs to this build's Electron CDP, not to all of Chromium.

### 3. Element picking

After `DOM.enable`, `Overlay.enable`, and `Overlay.setInspectMode({mode:'searchForNode',highlightConfig:…})`, a synthetic click via `Input.dispatchMouseEvent` produced `Overlay.inspectNodeRequested` with a `backendNodeId`. `DOM.describeNode` returned the expected `DIV` with `id=target`. To switch the mode off, this build requires `highlightConfig:{}` with `mode:'none'`; without it, it answers `Internal error: highlight configuration parameter is missing`. No scripted replacement for picking is needed.

### 4. Input without window focus

No window of the final pass was shown. `webContents.isFocused()` stayed false before and after input; `BrowserWindow.getFocusedWindow()` returned no window. After `Emulation.setFocusEmulationEnabled({enabled:true})` and DOM focus on the field, `Input.insertText`, a pair of `Input.dispatchKeyEvent` for ArrowLeft, and a second insert produced the expected string `Привет & prob!e` and a `keydown` event with `ArrowLeft`. A second control field stayed empty. `document.hasFocus()` on the driven page became true — this is emulation, not OS focus. Another app's active window was not measured by a separate API; keeping its pid is unproven. In one response's text rendering the tool escaped `&` as `&amp;`.

### 5. Console

With a single `Log.enable` and a JS call of `console.error('probe-console-log-only')`, no `Log.entryAdded` or `Runtime.consoleAPICalled` events arrived. After `Runtime.enable`, `Runtime.consoleAPICalled` arrived for both the next error and the previous one stored by Chromium. So `Log` does not replace `Runtime` for console; the Runtime-enabling policy stays in the spec. This sample also shows replay of old console events after enabling Runtime, not an exact history boundary of "only after first read".

### 6. Dialogs

For an undriven page, a `dialog.showMessageBox` call was intercepted before native UI, plus `webContents` event registration. `alert` and `confirm` went through internal `-run-dialog`; no public event about them was observed. Native dispatch requested an OK button and an OK/Cancel pair respectively. The actual native dialog screen was deliberately never shown, at the lead's requirement; that plain Electron would show it via `dialog.showMessageBox` is a conclusion from the [Electron 44.8.0 source](https://raw.githubusercontent.com/electron/electron/v44.8.0/lib/browser/api/web-contents.ts), not a window observation.

`prompt()` threw `prompt() is not supported.`, with and without a debugger. This matches the [window.prompt override in the Electron renderer](https://raw.githubusercontent.com/electron/electron/v44.8.0/lib/renderer/window-setup.ts); attaching CDP does not fix it.

With `Page.enable`, alert/confirm gave `Page.javascriptDialogOpening` with `hasBrowserHandler:true`. `Page.handleJavaScriptDialog({accept:true})` answered successfully; in a separate experiment `confirm` returned true although the intercepted native handler then returned Cancel. But native dispatch was still called, and its AbortSignal was not cancelled in the observation. This proves the CDP answer and proves neither the absence nor the clean dismissal of a real second native window: before delivery, the host must confirm no second dialog.

After a user gesture and setting `onbeforeunload`, closing `webContents.close({waitForBeforeUnload:true})` produced public `will-prevent-unload`. `event.preventDefault()` allowed closing. The event needs a synchronous decision: [Electron C++](https://raw.githubusercontent.com/electron/electron/v44.8.0/shell/browser/api/electron_api_web_contents.cc) passes `defaultPrevented` straight into the callback. It cannot be stored as a CDP dialog awaiting an async answer; for an undriven page main first declines the exit, and after the human's decision repeats the agreed action.

### 7. Renderer hang

A real `while(true){}` ran on a separate page, then mouse events were sent. The window was shown but `opacity:0`, frameless and unfocused: no human saw it. Without a debugger, a 16-second window brought internal `-unresponsive` and public `unresponsive`; the internal event's fields were `shouldIgnore:false`, `visible:true`, `rendererInitialized:true`. With a debugger attached beforehand, the same window brought neither event. Infinite renderer processes were stopped after measurement with `forcefullyCrashRenderer`, yielding `render-process-gone` with `reason:killed`.

A further control without a debugger — a continuous busy loop exiting after 18 seconds — gave `unresponsive`, then `responsive`, and the next JS request returned 42. In this control `unresponsive` arrived only past the 16-second mark: the observation window sets no deadline and guarantees no event timing. A never-shown window without a debugger produced no events over a separate eight-second window; this is a bounded observation, no proof of their full absence. Guaranteeing `page-unresponsive` under an agent debugger with Electron events alone is impossible: desktop needs the same separate lightweight request to the renderer as the managed host, outside the page command queue. The threshold belongs to someone else's renderer, not to waiting on your own host.

### 8. Keychain: security and Bun FFI

A single synthetic record `Tagma Browser Probe ce0f09a0` was created in the login Keychain, deliberately not a browser key. Before each read the lead was warned and relayed the operator's Deny request; the agent pressed no buttons. `screencapture` recorded the `security` process reading `/usr/bin/security find-generic-password … -w` and the `bun` process on direct `SecItemCopyMatching` from Bun FFI. The first read exited 0 with the test string, the second with OSStatus 0 and 42 bytes of data; the FFI value was not printed. Real browser keys were never read through these commands.

The operator reported entering the login Keychain password for Bun and choosing Always Allow; the Bun window appeared twice. The script had exactly one `SecItemCopyMatching` and one run of it. The reason for the second system window is undetermined; it must not be passed off as a second FFI call. After the reads the record was deleted before the Always Allow message arrived, so its final ACL and re-reading without a window were never verified.

A separate temporary Keychain with one control record allowed `security dump-keychain -a` before and after: trust stayed `/usr/bin/false` with requirement `identifier "com.apple.false" and anchor apple`. This control record took no part in login dialogs and proves nothing about adding Bun via Always Allow. Both synthetic records and the temporary Keychain were deleted. A full dump of all keychains was stopped without result and is not used as evidence. By the lead's decision, the product key is read by desktop main; the signed Tagma release's identity and ACL are undetermined by this experiment.

### 9. Chrome for Testing and mock Keychain

Two clean user-data dirs, `--headless=new`, Chrome for Testing 149.0.7827.55: one launch without `--use-mock-keychain`, one with it. Both reached CDP, wrote two synthetic persistent cookies via a local page and `Network.setCookies`, read them via CDP, and exited cleanly. Without mock on this machine no Keychain dialog was observed; the screenshot showed none. This guarantees no first launch on a clean account: prior Keychain records and trusts were never reset.

Both databases after clean exit held an empty plaintext `value` and 51 bytes of `encrypted_value` with a `v10` prefix. This proves writing works with mock, but neither cryptographic strength nor re-reading after a cold start. The build policy must explicitly choose Keychain behavior; the verified `--use-mock-keychain` is available for human-free launch with a 0700 profile directory.

### Addendum: CDP pipe under Bun

A separate sample from the [[01a147d6-ffd5-7df1-92f6-4999dc1c6e94|engine performer's]] message, also recorded by them in the [[eb1e2301|managed-host spec]]: Bun 1.4.3, Chrome for Testing 151.0.7922.71 from `~/.cache/puppeteer`, macOS arm64. `--remote-debugging-pipe` worked via `Bun.spawn` with extra fds and via `node:child_process` used by the Effect `ChildProcessSpawner` with `additionalFds`: `Browser.getVersion`, a whole 5 MB `Runtime.evaluate` result, about 1200–1450 round-trips per second, `Page.captureScreenshot`, clean `Browser.close` exit with code 0, and Chromium shutdown when the pipe closed. First response 0.7–1.6 s; one cold copy launch took 7.5 s, which the performer did not attribute to a pipe defect. `Bun.spawn` hands extra fds back as numbers for `Bun.file(fd).stream()/writer()`, `node:child_process` as streams. This is another performer's attributed result, not a rerun of this study; it gives no reason to move to a CDP port.

### What stayed unproven

The signed Tagma release in the ACL, the reason for the second Bun window and the final ACL of the deleted login record; the first headless launch on a clean macOS account; the absence of a second native dialog after the CDP answer; keeping another app's active window pid. These limits mean no failure of the verified capture, picking, PDF via native API, and input.
