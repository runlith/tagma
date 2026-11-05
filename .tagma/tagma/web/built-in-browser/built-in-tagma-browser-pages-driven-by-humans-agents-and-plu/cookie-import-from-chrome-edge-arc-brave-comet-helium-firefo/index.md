---
id: 01a147b0-e165-75df-b2b0-9a11eae10179
title: Cookie import from Chrome, Edge, Arc, Brave, Comet, Helium, Firefox, Safari, and Tagma profiles
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a147e4-e266-7d95-ae42-070fbdb94d27
---
Import carries a user's sign-ins from their browsers into a Tagma profile, so humans and agents work signed in; the operator put it in stage 1. A Tagma profile can also be the source: that is how sign-ins move between profiles on different hosts.

**Where it lives.**
- The `@runlith/browser-cookies` kit (`packages/browser-cookies`): the cookie model (name, value, domain, path, expiry, `secure`, `httpOnly`, `sameSite`, `partitionKey`, priority, source scheme and port), the import policy, and two ports — source reading and the encryption key.
- Adapters are their own modules in the kit directories; each declares itself, and composition wires the ones the platform needs:
  - Chromium-family reading — Chrome, Edge, Arc, Brave, Comet, Helium: profile discovery, a database snapshot together with WAL, v10 and v11 decryption, AES-GCM on Windows; the value prefix — the domain's SHA-256 — is stripped only at database version 24 and up and on an exact hash match; v20 (app-bound) is reported as undecrypted;
  - Firefox reading — `moz_cookies`, no decryption;
  - Safari reading — `binarycookies`;
  - Tagma-profile reading — through its host's `ProfileHost.session`;
  - key — macOS Keychain (`<Browser> Safe Storage`), Windows DPAPI, Linux libsecret.
- Stage 1 is macOS; the Windows and Linux adapters arrive with the Tagma release on those systems.
- Import databases and decryption belong to the server; desktop main reads the macOS Keychain key through Security.framework in its own process, with no `/usr/bin/security` and no Bun. The server receives the key over a separate `SafeStorageKey` port on the host channel — its own subject, not a `PageHost` call; with no desktop attached such a source refuses with `host-away`. The experiment established the `security` and `bun` request identities but not the signed Tagma release's ACL: the synthetic record was deleted before the Always Allow result was checked. When the release is checked on a synthetic record, they establish that the request and the added trust belong to Tagma's own signed application.
- Safari needs Full Disk Access; macOS attributes it to the responsible process, which differs between a server raised by Tagma.app and a server from the terminal. The performer's experiment establishes who gets access, and the settings section tells the human.

- The `browser` module operations: `list_cookie_sources` (found browsers and their profiles, Tagma profiles) and `import_cookies` (a Tagma profile and a source — a browser profile, a Tagma profile, or a JSON file). Any caller ([[39241ecf|operations]]). The answer: how many cookies were written, how many skipped as Google, how many undecrypted, how many the browser store rejected, which domains were replaced.

**Policy.**
- The `google.com` domain never moves, including between Tagma profiles: Google flags a carried session within about an hour. A human signs into Google directly in Tagma ([[447be62e|why]]).
- Import replaces cookies only for the imported domains, their ancestors and descendants; domain boundaries follow the public-suffix list with private domains (at Orca a stale list glued 600 suffixes, and foreign tenants shared the replacement scope).
- `SameSite` decodes by its own source's numbering, an unknown value means "unset": a mixed-up numbering silently lost Orca 135 cookies per profile.
- An empty value carries over empty.

**Writing.**
- The engine writes through the target profile's `ProfileHost.session` — a profile session, not a page one: human pages never get a debugger, and DevTools open on them never interfere. `Network.setCookies`, removal with `Network.deleteCookies`, snapshot with `Network.getAllCookies`; Electron's `session.cookies.set` silently drops `partitionKey`, so Orca writes the same way. One path fills the desktop partition and the managed-Chromium profile.
- The current cookies of the affected domains are removed before replacement. A single cookie the browser store rejected with its own validation counts in the answer without rolling the rest back; such cookies are lost — decrypted values are never written to disk, and there is no cold write into the profile database as at Orca. A broken write — a dropped session, a host failure — returns the snapshot.
- The profile's host must be attached, otherwise a `host-away` refusal.

**Risks the product accepts.** Cookie values are account keys, and import copies them into Tagma. macOS asks for Keychain access on an import that needs the key; that is the human's only step.

**What the performer proves.** Parsing and decryption on Chromium (v10, domain prefix at version 24), Firefox, and Safari fixtures yield the expected cookies; every source's `SameSite` decodes correctly; Google domains never move; a store-rejected cookie counts in the answer while the rest are written; a broken write returns the affected domains' earlier cookies (against managed Chromium); a move between two Tagma profiles carries sign-ins.

**What the operator checks.** Import from their own Chrome and Safari: sites where they are signed in open signed in in the panel.
