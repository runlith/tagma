---
id: 01a10593-9aa9-79d1-8e93-dd8f6b0d1ccf
title: "StreamStalled kills legitimate long generations: four Opus children at xhigh/high died at 300 s of silence on two providers"
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "Both had a step stall that started at the same instant (06:01:58.2–.3Z) and ended at the same instant (06:21:46.83Z), after short steps that completed normally. Earlier traces show several attempts opened in the same millisecond, all left `open`. The simultaneity points at a shared transport or connection-pool stall in the server, not at long model thinking.",
    "command": "continue_agent on audio-impl (01a1050e-0e5c…) and speech-impl (01a1050e-6093…), the only two children running",
    "expected": "Independent streams stall independently, if at all"
  }
---
Filed from project `runlith`.