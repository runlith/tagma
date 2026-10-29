---
id: 01a14c08-1c3f-7bde-a2e3-04710dac7353
title: Built-in browser pages present themselves to sites as ordinary Chrome, so Google sign-ins and anti-bot sites work
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-0476d576a8a6
sources:
  - kind: file
    ref: apps/tagma/desktop/src/browser/identity.ts
  - kind: file
    ref: apps/tagma/server/src/managed-browser/builds/chrome.ts
---
**Value.** Sites do not throw the built-in browser out as a bot or an "unsupported browser": sign-in to Google, X, LinkedIn, and Cloudflare-gated sites works.

**How.** In Settings → Browser on desktop, the "How desktop pages introduce themselves" choice: "As Chrome" (default) or "As Tagma".

**Behaviour.**
- "As Chrome" strips the Electron and Tagma tokens from the user agent; Google sign-in page requests get a Firefox user agent, and on exit the main document returns to the profile UA. A separate agent UA override is kept. "As Tagma" keeps the original identity.
- Human pages live without a debugger until an agent drives them, a screencast watches them, or element picking runs: sites count an attached debugger as a bot signal.
- Console capture, which needs `Runtime.enable`, turns on only by profile policy.
- Managed Chromium reports an ordinary Chrome user agent with no `HeadlessChrome`.

**Limits.** The choice takes effect after an application restart. On HTTP redirect `navigator.userAgent` moves to the final origin's identity only after load completes: an early script sees the old one; the HTTP header is picked per request URL. On managed Chromium high-entropy client hints are empty, as in any Chrome with `--user-agent`. Fingerprint spoofing is [[d576a8a6|promised]].
