---
id: 01a14c18-c833-7d88-b3bd-66edd19bc231
title: Finish the composition change-record, enforcement, landing, sandbox and speech Effect tests
ord: 40
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c19-6c7a-788b-a8e4-4b25132c42c7",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13b37-5351-7e3a-bda9-f7bf25d19486
sources:
  - kind: dir
    ref: apps/tagma/server/src/composition/testing/change-record
  - kind: dir
    ref: apps/tagma/server/src/composition/testing/checkout-files
  - kind: dir
    ref: apps/tagma/server/src/composition/testing/enforcement
  - kind: dir
    ref: apps/tagma/server/src/composition/testing/landing
  - kind: dir
    ref: apps/tagma/server/src/composition/testing/sandbox
  - kind: dir
    ref: apps/tagma/server/src/composition/testing/speech
---
Migrate the rest of composition/testing/{change-record,enforcement,landing,sandbox,speech,checkout-files} and their own fixtures to @runlith/effect-test. The checks keep the owner contract, await an event and own resources; no Promise runner hides in a helper. Checks: all 13 style-checker shapes over the 122 current files — no violations and no unread spots; scoped typecheck and the touched tests green. The original automatic result in 61 files and its diff were fully re-read, semantic fixes made by hand. The single Sol review read all current files; the confirmed cleanup finding was fixed with no repeat review. Continuous independent reading of every line of the historical raw diff is not finished. The shared composition fixtures contract is agreed with its runner before changing.
