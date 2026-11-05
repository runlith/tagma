---
id: 01a1a2cf-058e-7f33-a6cd-6d6dc7e9bcae
title: "Files an issued release reads are frozen wire formats: today's writers satisfy every issued reader, and the next release's shape is frozen before it is cut"
ord: 10
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1a2c3-df29-790a-ac75-a876cfb6a896
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/attempt.ts
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/feed.ts
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/manifest.ts
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/restart.ts
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/stepBack.ts
  - kind: file
    ref: apps/tagma/server/src/installation/testing/frozen.ts
---
`install.json`, `install/attempt.json` and `returned.json`, the step-back record `install/back.json` (the leaving build writes it; it or any later start of a build that carries chain return settles it, and an issued build before that never reads it), `restart.json`, the update record `update.json`, the machine registry `registry.json` and the release feed cross releases both ways: an issued release reads the manifest of the release that replaced it, the attempt and restart records its successor wrote (after a rollback or a step back), the registry it reseeds a lost database from and the feed today's cut publishes; the running release reads what the issued one left. An issued reader decodes with its own build's schema and can never change, so a writer change it rejects breaks a person's machine with no trace in the repository — an attempt record that does not read blocks every install until a start sets it aside and gives up its automatic return ([[9e8adf53]]).

- **Frozen shapes** are copies of the issued readers, not imports, in the installation module's `testing/frozen.ts`: `FROZEN` lists each shape with the releases that carry it (0.2.0–0.2.2 share one), its manifest closure checks and identity digest included. `installation/frozen.itest.ts` writes each file through today's real writer — every role and part kind a cut can write, every attempt and return the schema admits, a predecessor's and a successor's restart record, the update record the release channel keeps — and decodes it with every frozen reader, and `cut/frozen.itest.ts` does the same for the feed the release toolchain writes; it also passes values sampled from every frozen schema through today's readers (`release-channel/frozen.test.ts` for the feed, `installation/registry/issued.itest.ts` for the registry, whose writer is the parts its owners contribute).
- **The next release is frozen before it is cut.** The last entry, `NEXT`, is a copy of the shape this tree writes, and `installation/frozen.test.ts` fails as soon as a wire schema moves away from it. A change to a shape therefore keeps the previous `NEXT` as an entry of its own and writes a new `NEXT`, never edits it in place: whichever commit a release is cut from, its shape already stands frozen. An entry no release carried may be dropped once the release tags prove it.
- **Readers are lenient where a value only passes through.** Unknown fields are ignored (Effect's default decode); a manifest part's `role` and an irreversible change's `store` are open strings — required roles are still checked, an unknown store is shown by its name — and the feed decodes per entry: an entry this release cannot read is dropped and the newest readable one is offered, while a feed with none still refuses `source-unreadable`. A field the reader acts on — the manifest `version`, a part's `kind`, the attempt's `data` and `words`, a restart `door`, a phase `outcome` — stays closed, so widening it fails the frozen test instead of the issued reader. A file that does not read still answers its owner's typed refusal.
- 0.1.x shapes are not frozen: their sources predate this repository, and they read no feed this core publishes.
