---
id: 01a12c46-ab9c-7595-ace5-ac3a7fa6848f
title: "Credentials without vendor knowledge: account facts at the adapter, open document, borrowed accounts"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c47-00db-7c9c-bac5-59ed12329bd1",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12c24-69a2-7f74-a6cf-a29052b10a62
  - kind: waits-on
    to: 01a12c46-ab9c-7595-ace5-ac39b8a4772b
---
Sections "Adapter contract" (sign-in, account facts) and "Registry" (removed provider) of the spec [[52b10a62]]. The vendor `ModelCredentials` methods move into adapters; key, label and multiple accounts are the adapter's decision (`oauth/accountKey.ts`); `credentialDocument.ts` is an open form keyed by provider id with no `version`, and a missing provider's section is stored as is (including writes from `tagma auth`); import reconciliation is the adapter's function; a provider may borrow another's accounts without a refresher. Done: a removed provider's rows survive another's write, its return continues with the same account, all of the operator's current accounts work.

Made in commits ef282b3cb3, 7fb280a2bf, 7cf463eb0d (review fixes: device sign-in poll cadence at the vendor interval, decoding only the requested account, the adapter's `sameAccount` also for fixed keys, the credential schema as the identity codec, `vendor` check at device sign-in, dead `code` removed from `complete_sign_in`). `tagma auth <provider>` now leads sign-in through the server's `begin_sign_in`/`complete_sign_in`. Not proven: live sign-in by each vendor and `tagma auth` were not run at the operator's; the operator's `tokens.json` file in v3 form is read by form tests but not checked against a real file; the v2 form migration is folded (the operator has v3); one broken provider row refuses its account list.
