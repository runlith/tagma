---
id: 01a13bfd-972d-7858-8059-1724c709152d
title: "Move to Effect style: the speech module"
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c17-b1ef-74f0-b44d-13d1d48b5a83",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/speech
---
Migrate all of `apps/tagma/server/src/speech/`, including its tests, to the recorded Effect style, keeping audio/transcription event order, cancellation, scopes and spans. Do not rewrite others' unfinished lines; the speech packages and `composition/testing/speech` are handled separately. Current effect-style is 0; the narrow speech typecheck passed, own unit tests 5/5. Two Sol xhigh reviews finished before the single-reviewer limit; the Speaking-shape remarks and the inherited shutdown defect were fixed by hand. Automigration was used before the ban; after the interruption every touched file and the whole diff were read in full, continuation is targeted manual edits.
