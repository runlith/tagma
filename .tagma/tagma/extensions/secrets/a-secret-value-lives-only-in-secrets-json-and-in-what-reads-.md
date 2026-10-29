---
id: 01a123ad-a26a-771a-b839-5773f1844d71
title: A secret value lives only in secrets.json and in what reads it, and the store core names no owner kind
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/secrets/keeper.ts
  - kind: file
    ref: apps/tagma/server/src/secrets/store.ts
---
Every secret Tagma hands to a process or a connection lives in one document, `secrets.json` in the data directory (0600, through `CredentialFile`), keyed by owner kind and holder key. It never enters settings, the graph, feeds or operation answers: `read_secrets` answers `{name, description, set}`, `set_secret` and `remove_secret` answer the same row, and store refusals do not repeat the file error text, because parsing the document quotes what lies in it. So a secret cannot be a setting: settings are read through `read_settings` and the live channel.

The core names no owner kind, so renaming or adding one touches only its module. The module owning a kind registers it through `SecretOwners.register`: it lists the holders a project sees with the names each declares — which is how the core checks an id and a name — and it is told when a holder's value changed, so it restarts or reconnects only what reads that value. The holder key is the owner's own; MCP keys a project-scope server by project id, so two projects' servers of one name never share a value. Removing an owner drops its values through `SecretOwners.drop`; the core sweeps nothing on its own.

A handout carries each value in two forms for the redactor — as is and as inside a JSON string — because a tool often answers JSON text. A short value masks every occurrence of itself in any answer, and that is the operator's decision. Writing the value already standing changes nothing and notifies nobody.
