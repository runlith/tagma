---
id: 01a14742-3850-72e4-936c-231c447be62e
title: "Orca: persistent profiles, a user agent with no Electron tokens, and Firefox on Google sign-in pages"
ord: 4
tags: ["research"]
fields:
  {
    "source": {
      "name": "Orca 0df25b7 — browser-session-*, browser-cookie-*, browser-google-auth-ua",
      "ref": ".external/orca/src/main/browser"
    }
  }
---
Paths are relative to `.external/orca/src/main/browser/`.

**Profiles.** Persistent partitions per "Orca profile × browser profile": `persist:orca-browser` and `persist:orca-profile-…` (`shared/orca-profiles.ts`). Nothing is keyed by worktree or agent: an agent tab with no explicit profile shares the default profile and the user's cookies. Partition policies — UA, proxy, certificate guard, permissions, downloads — are set before the first page (`browser-session-partition-policies.ts`).

**User agent.** Stock Electron UA carries `Electron/x` and the app name; with it users were thrown out of x.com and LinkedIn (commit `fb85f88d64`). "Cleaned" mode strips both tokens by default via `app.userAgentFallback` before ready (`browser-process-user-agent.ts`) and rewrites UA on http/https/ws/wss. Client hints stay Chromium's ("Chromium" brand, not "Google Chrome"). The mode is per-process and needs a restart: workers take the process-wide default. Measured tradeoff (`browser-identity-mode-store.ts:12-16`): Cleaned passes Turnstile and WhatsApp but not full-page Cloudflare checks; Native is the reverse, and without signing into Google.

**Signing into Google.** On `accounts.google.com` and `accounts.youtube.com` (exact match) Orca presents itself as Firefox 140 with no client hints (`browser-google-auth-ua.ts`): Google binds the session to the "identity" of the browser used at sign-in. Moved Google cookies are flagged within about an hour, so the `google.com` domain is not imported. Google itself has blocked OAuth from embedded webviews since 2021.

**Masking rejected.** Anti-detection injections removed: "their overrides are themselves published bot signatures" (commit `fb85f88d64`). The debugger never attaches to plain tabs, `Runtime.enable` is never set in cross-origin iframes. There is a stand that verifies UA and `sec-ch-ua` sameness across HTTP, WS, documents, and workers on real Electron.

**Cookie import** from Chrome, Edge, Arc, Brave, Comet, Helium, Firefox, and Safari is about 4.3k lines: key from Keychain (`<Browser> Safe Storage`, PBKDF2), DPAPI on Windows, AES-CBC/GCM, writes via CDP (because `cookies.set` silently drops `partitionKey`), domain replacement with rollback. The product reason is "agents can reuse your logins". History of silent losses: wrong SameSite numbering (135 cookies per profile), stale public-suffix list, cookies with empty values.

**Electron trap.** A session has one `webRequest.onBeforeRequest`: the next handler silently replaces the previous one (Electron docs). Inside Orca itself this is how the doc-preview allowlist gets overlapped (candidate defect, not verified by launch).

**Misc.** Certificates: only `ERR_CERT_AUTHORITY_INVALID` is allowed, with a leaf pin on the endpoint, because Chromium caches the decision per session. WebAuthn is HID keys only; no system passkeys. Third-party cookies are not blocked.

**Size.** Sessions and policies 1.1k lines; UA 0.7k; cookie import 4.3k; certificates and WebAuthn 0.9k; UI settings 0.9k.
