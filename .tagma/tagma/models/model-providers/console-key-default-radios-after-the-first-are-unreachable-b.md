---
id: 01a0cac3-1ab7-7850-b605-5b8a591784b2
title: "Console-key default radios after the first are unreachable by keyboard: roving tabindex with no arrow handler"
ord: 1
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/providers/auth/ConsoleKeyGroup.svelte
---
`ConsoleKeyGroup.svelte:108` renders the console keys' default choice as a radiogroup with roving tabindex (unchecked radios `tabindex={-1}`, `:121`) but no arrow-key handler — while the subscription ledger (`ProviderGroup.svelte:158-168`), the density switch and the gauge switch all move checked-with-focus on arrows. With two or more console keys (the Go multi-key case), a non-default key is neither in tab order nor arrow-reachable: unreachable by keyboard entirely. (Single-key cards are unaffected — the one radio is the default and tabbable.) The comment at `:104-105` claims this is "the same radiogroup" as the subscription one, which has the handler.

Give the group the same arrow handling its siblings have. Done when every console key is keyboard-reachable, with a test pinning arrow movement beside the subscription case.