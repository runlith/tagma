---
id: 01a12d4d-77f4-7062-a32b-08671cfa3cd9
title: "A borrowed account is never refreshed by Tagma: the token is read at the creditor, and the creditor's own CLI renews it"
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/providers/credentials/borrowed.ts
---
A provider declaring `borrows` receives signed accounts of the selected CLI creditor in `TokenStore` next to its own rows; its own rows win on key match. Sign-in through Tagma and addressed use of the CLI or a native model on its sign-in confirm the selection; an old automatically found default record does not. The first native-model request itself asks for the creditor's default sign-in when no selected signed record exists yet; passive credentials and quota never do. A borrowed account's grant belongs to the creditor CLI: after its refresh the previous access token is unusable at once, and the new one is written with CAS over the sent refresh token, so Tagma-side refresh would diverge from the CLI and sign it out.

- Each request re-reads the token through `borrows.read(directory)`; on 401 it re-reads, and when the token there is unchanged and not expiring, that is a demand to sign in again (`reconnect`), not a retry.
- The creditor's `accounts.renew` refreshes an expiring token, launched through `AccountCli` in the account environment (for Claude, headless `claude -p /usage`); parallel requests of one account wait on one launch. The launch lives apart from its caller, so an interrupted request does not cancel it for the rest. Before launch the token is re-read: when another client already refreshed it, the CLI never starts.
- A borrowed account cannot be removed or renamed through the borrower (`account-borrowed`, ahead of any default changes): the record and sign-in belong to the creditor. Which account is whose is decided by presence of a row in its own store (`TokenStore.owns`), not by readability of its credentials.
- Borrowed accounts are not part of the borrower's sign-in status: that section holds its own sign-in, and borrowed ones show in the creditor's section.
