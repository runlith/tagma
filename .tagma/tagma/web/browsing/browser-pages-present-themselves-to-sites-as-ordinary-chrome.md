---
id: 01a14c08-1c3f-7bde-a2e3-04710dac7353
title: Browser pages present themselves to sites as ordinary Chrome; Google sign-in needs a windowed profile of the installed Google Chrome
ord: 7
tags: ["feature"]
fields:
  {
    "state": "partial"
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
**Value.** Sites do not throw an agent's browser out as a bot or an "unsupported browser", so an agent can work in the user's own accounts. Sites that refuse every embedded or headless browser — Google sign-in first among them — open in a windowed profile of the user's installed Google Chrome.

**How.** On desktop, Settings → Browser, "How desktop pages introduce themselves": "As Chrome" (default) or "As Tagma". On the managed host, the profile document: `build` `installed-chrome` with `window` `shown` runs the installed Google Chrome as an ordinary windowed browser.

**Behaviour.**
- "As Chrome" strips the Electron and Tagma tokens from the user agent; Google sign-in page requests get a Firefox user agent, and on exit the main document returns to the profile UA. A separate agent UA override is kept. "As Tagma" keeps the original identity.
- Human pages live without a debugger until an agent drives them, a screencast watches them, or element picking runs: sites count an attached debugger as a bot signal.
- Console capture, which needs `Runtime.enable`, turns on only by profile policy.
- Managed Chromium reports `navigator.webdriver` false in both window modes. A hidden profile reports an ordinary Chrome user agent with no `HeadlessChrome`; a shown profile is windowed Chrome with Chrome's own user agent and client hints, its pages tabs of one window.

**Limits.** Google refuses sign-in ("This browser or app may not be secure") on the desktop browser and on hidden managed profiles, measured 2026-11-04 on Electron 44.8.0 (Chromium 152) and Chrome for Testing 151; on Google's page the desktop's Firefox user agent is contradicted by every other property it exposes. A shown installed-Chrome profile reaches Google's account lookup. The desktop choice takes effect after an application restart. On HTTP redirect `navigator.userAgent` moves to the final origin's identity only after load completes: an early script sees the old one; the HTTP header is picked per request URL. On a hidden managed profile high-entropy client hints are empty, as in any Chrome with `--user-agent`. A shown profile opens a real window on the user's screen. Fingerprint spoofing is [[d576a8a6|promised]].
