---
id: 01a14c08-1c3f-7bde-a2e3-04706355b04b
title: Site sign-ins move into a Tagma profile from Chrome, Edge, Arc, Brave, Comet, Helium, Firefox, Safari, another profile, or a cookies file
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: dir
    ref: packages/browser-cookies
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/section/CookieImport.svelte
  - kind: file
    ref: apps/tagma/desktop/src/browser/keychain.ts
  - kind: file
    ref: apps/tagma/server/src/browser/contract/wire/cookieOperations.ts
  - kind: file
    ref: apps/tagma/server/src/browser/cookies.ts
  - kind: symbol
    ref: apps/tagma/server/src/composition/browser.ts
    symbol: cookieSourcesLayer
---
**Value.** Humans and agents work in sites the human already signed into in their own browser, without signing in again in every Tagma profile.

**How.** The "Import sign-ins" block in Settings → Browser; the `list_cookie_sources` and `import_cookies` operations. A source is one of: a Chrome, Edge, Arc, Brave, Comet, Helium, Firefox, or Safari profile; another Tagma profile; a browser-extension-format cookies JSON file.

**Behaviour.**
- Import replaces the cookies of the carried domains, their parent and child domains, and leaves the profile's other cookies alone.
- `google.com` cookies never move: Google drops a carried session — sign into Google inside Tagma.
- The answer counts recorded, Google-skipped, unreadable (foreign key, unrecorded partition), and store-rejected cookies, and names the domains.
- A write broken mid-way restores the replaced cookies and refuses with `import-broken`. Imports into one profile run one at a time.
- The Chromium-family browser key comes from the macOS Keychain; the Tagma application reads it, and macOS asks permission. Safari needs Full Disk Access.

**Limits.** Installed browsers read only on macOS; elsewhere only Tagma profiles and files are available. Importing from Chromium browsers without a running application refuses with `host-away`. The target profile's host must be connected.
