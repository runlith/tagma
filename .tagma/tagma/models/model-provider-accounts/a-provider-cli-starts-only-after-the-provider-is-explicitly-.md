---
id: 01a164d4-4b95-7103-9928-d27241797cec
title: A provider CLI starts only after the provider is explicitly selected
ord: 17
tags: ["rule"]
sources:
  - kind: dir
    ref: apps/tagma/server/src/external-harnesses
  - kind: dir
    ref: apps/tagma/server/src/providers
---
Selection means sign-in through Tagma, an addressed catalog request, or use of the provider, model or CLI thread. It needs no separate enable. The binary's presence, its discovery and old automatically found sign-in records are no selection; passive startup, catalogs, quotas, lists and integration installs do not start an untouched CLI.
