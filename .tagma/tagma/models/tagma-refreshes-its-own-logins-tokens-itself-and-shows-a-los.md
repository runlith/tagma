---
id: 01a14c08-22b6-75de-88f8-5bff8fe67900
title: Tagma refreshes its own logins' tokens itself, and shows a lost login as "Sign in again"
ord: 18
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: dir
    ref: packages/credential-file
  - kind: file
    ref: apps/tagma/server/src/providers/credentials/tokens.ts
  - kind: file
    ref: packages/llm/src/oauth/FileTokenStore.ts
---
**Value.** The operator does not re-log in on every token expiry, and a lost login is visible before a thread falls on it.

**How.** On its own, with no operator acts; the mark is "Signed out" or "Sign in again" on the account line and in the status bar.

**Behaviour.** A token of Tagma's own login that will soon expire refreshes before the call under the credential file's interprocess lock, so parallel threads and servers do not spend the refresh twice; a 401 refusal refreshes the token once and repeats the call. A refresh that answered for another account does not change the line and asks to log in again, as do no refresh token or a vendor refusal. Credentials lie in machine files with owner-only rights and are replaced atomically.

**Limits.** Accounts borrowed from a CLI Tagma never refreshes ([[42804f17]]). There is no importing of others' logins: lines once imported from a CLI are dropped on reading.
