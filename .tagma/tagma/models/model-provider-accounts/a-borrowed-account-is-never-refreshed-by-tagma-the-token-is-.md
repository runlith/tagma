---
id: 01a12d4d-77f4-7062-a32b-08671cfa3cd9
title: "A borrowed account is never refreshed by Tagma: the token is read at the creditor, and the creditor's own CLI renews it"
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/providers/credentials/borrowed.ts
---
The selected sign-in mode is authoritative: a borrowed mode exposes the creditor CLI's accounts, and the owned mode exposes Tagma's own grants. A signed observation from an adapter declaring discovery can establish the creditor's login without a preceding provider choice; undeclared creditors still need addressed use. Each native request rereads the credential at the account's exact address. Its grant belongs to the CLI, whose refresh invalidates the old token, so Tagma never refreshes it itself.

An expiring readable file can be renewed through the creditor's declared command; parallel requests share one renewal, and a fresh reread avoids an unnecessary launch. A missing file never starts renewal. A rejected file is reread, and an unchanged Codex file demands reconnecting rather than forcing a credential store. A keyring-only Codex login serves CLI threads but leaves native ChatGPT unavailable; Tagma neither reads the keyring nor exports its grant. Codex status does not expose the effective account identity without a side-effecting app-server start: if failed keyring cleanup leaves a readable stale auth.json, that file can name a different account from the effective CLI login.

Borrowed records are renamed or removed at their creditor, and the borrower's sign-in status keeps its own attempts rather than duplicating the creditor's rows.
