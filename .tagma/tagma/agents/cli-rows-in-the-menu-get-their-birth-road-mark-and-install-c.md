---
id: 01a1501e-db4e-7db5-8b3b-6da789935b42
title: CLI rows in the '+' menu get their birth road, mark, and install command from the server; the app never reads the server adapter table
ord: 91
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a14fe9-0964-7561-900a-61f7987b9fc1
---
**What is wrong.** Per the delivery review [[987b9fc1]]:
- `threads/ColumnHead.svelte` (`opensChat`) decides whether a CLI row opens a chat from the raw `threads.harnessTransport` setting. That repeats the birth resolution of `birthTransport` without its `hosts` condition, and rule 51c66cb6 forbids deriving one fact twice.
- The app reads the server adapter table (`external-harnesses/contract/service/table`):
  - mark and install command — in `ColumnHead.svelte`, `birth/ConnectCard.svelte#cliOf`, and `native/HarnessMark.svelte`;
  - ACP profile presence — in `external/transport.ts` (`to`).
  That is a service layer, not a wire.

**What to do.**
- The server gives the birth road (`terminal`/`acp`) for the project, the mark, the install command, and the translation the CLI thread gives, in the type row (`ThreadTypeRow.harness`) and in `HarnessRowDetail`.
- The app takes that data from there; the adapter-table import leaves the app.
- Note that birth-time `transportAt` resolves the CLI home folder, so reading it needs a side-effect-free path.

**Where to start.** `threads/library/declared.ts#offeredIn`, `threads/contract/wire/harness/types.ts#harnessSpawnTypes`, `external-harnesses/birth/transport.ts`.

**Proof.** `rg "external-harnesses/contract/service/table" apps/tagma/app/src` is empty; typecheck and the affected owners' tests.
