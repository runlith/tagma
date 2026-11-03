---
id: 01a1a2c3-df29-790a-ac75-a876cfb6a896
title: "Freeze the wire formats issued releases read: manifest, attempt, restart record and feed"
ord: 89
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a2ba-87bf-74f8-9ab6-df9927e074bb",
    "status": "in_work"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/manifest.ts
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/attempt.ts
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/restart.ts
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/feed.ts
---
`install.json`, `install/attempt.json` and `install/returned.json`, `restart.json` and the release feed cross releases: an issued release reads what today's code writes, and today's code reads what an issued release wrote. Their schemas decoded strictly and nothing said which shape is frozen, so a field made required, a literal widened or a struct closed on one side broke the other silently on a person's machine.

Done when:
- the shapes the issued releases (0.2.0–0.2.2, one shape) read and write are frozen as copies in the installation module's testing entry, with the releases that carry them;
- one test writes each file through today's real writer and decodes it with every frozen reader, and reads values every issued writer can produce through today's real reader;
- readers are lenient where the format crosses releases: the feed decodes per entry, a manifest part's role and an irreversible change's store are open strings, unknown fields are ignored; a broken file still answers its typed refusal;
- an #explanation sourced to the wire files says which shape is frozen and why the readers are lenient.
