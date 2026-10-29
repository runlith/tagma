---
id: 01a14a07-3665-70b6-8d89-89ac09510f24
title: Browser cookies
ord: 27
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/cookie.ts"
      },
      {
        "at": "src/source.ts"
      },
      {
        "at": "src/policy.ts"
      },
      {
        "at": "src/file/file.ts"
      },
      {
        "at": "src/chromium/chromium.ts"
      },
      {
        "at": "src/firefox/firefox.ts"
      },
      {
        "at": "src/safari/safari.ts"
      }
    ],
    "id": "@runlith/browser-cookies",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/browser-cookies
---
A person carries their site logins into the Tagma browser, and the kit reads them where browsers hold them: Chromium-family databases with a Safe Storage key, Firefox `moz_cookies`, Safari `binarycookies`, and export files — into one cookie model, off the event loop, naming the unreadable as a count instead of silently skipping. The import policy decides what moves over (not google.com) and which domains are replaced per the public-suffix list. The kit does not mine the encryption key itself: that is the `SafeStorageKey` port, filled by the host holding Keychain access; where to write cookies and how to roll back the write is the caller's business.
