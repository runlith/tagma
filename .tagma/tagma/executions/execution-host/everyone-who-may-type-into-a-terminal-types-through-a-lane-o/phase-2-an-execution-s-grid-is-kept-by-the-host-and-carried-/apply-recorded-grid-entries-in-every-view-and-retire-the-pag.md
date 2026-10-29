---
id: 01a0cf56-2adb-756b-994c-a3635f7838e9
title: Apply recorded grid entries in every view, and retire the page-local grid publish
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d0f4-6c35-738b-b09d-61fcab06b856",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0cf56-2827-7f36-a2d4-6c54da58f62e
  - kind: waits-on
    to: 01a0cf4b-e145-75fe-9035-2347893509b3
  - kind: waits-on
    to: 01a0cf56-2ad8-7e4e-8344-fd81271ce57d
---
Build the views part of [[da58f62e]] (section 5) in `RecordStream`, `TerminalPane`, `TerminalGrids` and `TerminalFit`, once the host delivers the track and the elected view stands. Done when the live cases of section 7 were checked across two windows and doctor over the touched paths is clean.