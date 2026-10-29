---
id: 01a16f26-e431-7c77-b884-76d2a1457df1
title: A commit hash in an agent answer is a link to that commit in its project's Git view
ord: 10
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03c0e4e2e9fe
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03c767192d2e
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/commitAnchors.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/commitCode.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/CommitLinks.svelte.ts
  - kind: symbol
    ref: apps/tagma/server/src/workspace/contract/wire/repositoryReads.ts
    symbol: WORKING_OPERATIONS
---
**Value.** Agents name commits by hashes. The operator clicks a hash and sees that commit — its files and diff — in the Git view of the project holding it, even if it's another project on the machine.

**How.** A hash in the thread feed, block body, thread peek, and plain message text; the `locate_commits` operation; a jump to `?commit=` of the found project's Checkout page.

**Behaviour.**
- A candidate is inline code of only lowercase hex characters, 7 to 64 long, and a standalone word of the same form in text if it has both a digit and a letter: ordinary words and numbers aren't asked.
- Only a hash the server confirmed as a commit becomes a link; the tooltip is the commit subject. Unconfirmed stays code. In Markdown, checking starts after streaming ends.
- First searched in the place's open project stores, then in all the machine's registered projects. All place messages' hashes go in one call, and the answer is remembered while the place is open.
- A short hash naming more than one commit doesn't become a link.

**Limits.** A text word of only digits or only letters isn't recognized, only inline code. A commit in none of the machine's registered stores stays text. A "not a commit" answer isn't re-read until the place changes.
