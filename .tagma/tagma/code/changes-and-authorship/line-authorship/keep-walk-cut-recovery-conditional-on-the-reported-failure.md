---
id: 01a18a54-9d01-7419-9472-bdc3f45b65fd
title: Keep walk-cut recovery conditional on the reported failure
ord: 152
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3c-15eb-7a51-a5e5-75762f658f69",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a17adc-0b73-7652-a40b-bc8da9ddeb9f
  - kind: relates
    to: 01a18679-d5f7-7d63-a817-4658b089d651
---
Correct the generic walk-cut recovery so a deterministic parser or configuration failure is not promised to disappear once workers are free. Preserve the reported cause and caller-specific ways out; do not bypass dependency checking or alter source-resolution guarantees.