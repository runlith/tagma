---
id: 01a10c46-51dc-7b25-9f6a-c5ef57f030fc
title: "Pairing UI: the \"Phone & devices\" section, the /pair page, the Unpaired screen, device refusal in Standing"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10b63-faa6-7691-9b8f-2144e40541ec",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a10b84-a62c-7c1f-a5ff-786268a2d306
  - kind: implements
    to: 01a10b84-bec8-7182-b0bf-018c6ab92e8d
  - kind: waits-on
    to: 01a10c46-51dc-7b25-9f6a-c5ed6fee8958
  - kind: waits-on
    to: 01a10c46-51dc-7b25-9f6a-c5ee3db4ab5a
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/Standing.svelte.ts
---
The client side of pairing from [[68a2d306]] and [[6ab92e8d]]: the section on desktop and phone, `/pair`, `Unpaired` with the code field, a `Standing` that tells device refusal apart from transport failure, the machine name in texts. Waits on the operations of [[6fee8958]] and the shell of [[3db4ab5a]].

Done when phone pairing in the tailnet runs from QR scan to Home, manual code entry works in the installed PWA, and revocation leads to `Unpaired`.
