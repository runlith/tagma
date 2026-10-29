---
id: 01a14742-3850-72e4-936c-2319609d2ca5
title: "Orca: the page is an Electron <webview> in a permanent overlay shell, guest policies set in main before registration"
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "Orca 0df25b7 — src/main/browser, renderer browser-pane, main/window",
      "ref": ".external/orca/src"
    }
  }
---
Paths are relative to `.external/orca/src/`. "Conclusion" marks an inference from code, not something read directly.

**Primitive.** Each page is an Electron `<webview>` in the main window's renderer (`webviewTag: true`, `main/window/createMainWindow.ts:133-136`). Named or featured popups are a `BaseWindow` with two `WebContentsView` (origin bar and page, `main/browser/popup-origin-bar-window.ts`). In headless `orca serve` (Electron flavor) — a hidden `BrowserWindow`.

**Guest security.** `will-attach-webview` is closed by default: src and partition from an allowlist, forced own preload, `nodeIntegration` off, `contextIsolation`/`sandbox`/`webSecurity` on (`main/window/main-window-webview-security.ts:66-110`). Guest policies (navigation, popups, permissions) are set on `did-attach-webview`, before registration from renderer: otherwise `target=_blank` and early redirects slip through. Registration from renderer verifies the guest type and that the policy is already set — no renderer-supplied id is trusted.

**Layout.** Electron destroys a `<webview>` when its DOM parent is removed. So the guest is never moved: each page has a permanent shell in the worktree overlay, the tab moves only a CSS anchor (`renderer/.../host-guest/browser-page-viewport.ts:1-5`). `display:none` stops painting and screencast; an invisible but still painting page is `opacity:0` + `inert`. Hidden worktrees keep at most 4 live guests (LRU), because each guest is a Chromium process (#12137).

**Input.** The guest's keys, clicks, wheel, and native drag never reach renderer. App shortcuts are caught in main via `before-input-event` and forwarded; during drag all webviews get `pointer-events:none`; clicks outside menus are caught on window blur; before hiding, focus returns, or macOS activates another app. Zoom sits on the partition host (HostZoomMap).

**Policies.** Navigation: http, https, file, blob over http(s). `window.open` denied by default: a plain link opens a new tab, a named popup a child window keeping `window.opener` (a pre-created WebContents is used), a page with no user gesture opens at most 4 tabs per 2 s. Permissions denied by default with a short list (fullscreen, clipboard, notifications…); camera and microphone via macOS TCC; screen capture denied. Downloads route to the page; certificate errors closed except local hosts with a pinned leaf.

**Persistence.** A worktree stores tabs and pages (url, title, favicon, profile/partition, viewport); back/forward stack, scroll, and zoom are not stored; restore reloads the url.

**Size.** About 66k lines without tests for the whole browser (main 41k, renderer 25k). The embedding core is about 6–8k (reading agent's estimate); the rest is automation, remote pages, cookie import, network routing. `BrowserManager` is 17 inheritance levels and about 20 Maps over two key spaces; it sources stale-guest bugs (conclusion).

Its own `orca-preview://<grant>/<path>` protocol shows local files and HTML in a separate partition: no grant — no bytes, CSP `default-src 'self'`, the grant is revoked on navigation.
