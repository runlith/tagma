---
id: 01a15f7f-fef4-7f68-bee1-8b2651e05844
title: Quota table shows a provider's accounts under the sign-in they are billed to, so model spendability looks rows up by account source
ord: 14
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bf0948797f4
sources:
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/providers/usage/Accounts.svelte.ts
    symbol: UsageAccounts.signing
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/models/spendability.ts
    symbol: signingRows
  - kind: symbol
    ref: apps/tagma/server/src/providers/quota/ledger.ts
    symbol: accountQuotaLayer
---
A provider on Tagma's own path that signs requests with another provider's sign-in in CLI-login mode (Claude Tagma with the Claude Code sign-in) has no rows of its own in the public quota table: `publicTable` carries them under the creditor and merges the quota with its row. The run picks the account through the same catalog's `accountSource`. Model spendability — the compact menu, the summarizer chain, keep-warm — also looks rows up by `accountSource(provider)`, and `pays` names that row's provider. The app receives the same answer in each catalog provider's `accountSource` field and reads signing rows through `UsageAccounts.signing`: the thread's accounts, linked providers and quota in team settings, the "… pays" signature in the compact menu and feed.

Looking rows up by the provider's own id would show its models as "not connected" while runs go through on them.
