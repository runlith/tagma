---
id: 01a13224-32b5-7f44-8ffc-39812a2de1fd
title: Holdings reads metadata over the standing index; hunks are only needed for changed inputs
ord: 3
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1321c-227d-769c-a933-e64736bef6d4
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/inputs.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/hunks.ts
---
Holdings reads metadata over the standing index; hunks are only needed for changed inputs.

Record order matters inside a path: `path, at, id` keeps replay and lets SQLite walk the partial standing index, while a shared `at, id` sends the plan through the checkout's whole history with a sort. The probe receives metadata and version presence, and hunks are read from `workspace_change_text` by id only for inputs the fold needs; after a separate read a hunk is accepted only when both digests match the probe, so the operator's glued record never substitutes a new edit into an old input. A creation hunk from empty text covers the whole afterText: the already-read text under an unchanged afterHash saves reading it a second time from payload.
