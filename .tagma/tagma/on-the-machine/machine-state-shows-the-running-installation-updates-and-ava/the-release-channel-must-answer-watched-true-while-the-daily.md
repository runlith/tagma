---
id: 01a14c37-8e38-797a-96f5-289055bfcccf
title: "The release channel must answer watched: true while the daily feed update works"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17f1d-0712-7796-8a03-a68232e94329",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14c05-71a7-71c8-88a1-ee4b86343018
  - kind: implements
    to: 01a17f29-c340-781d-b849-69493bb9e31f
---
release-channel always answers `watched: false` while a daily feed update is in effect, and the screen shows a false warning that watching has stopped. Fix at the value's producer.
