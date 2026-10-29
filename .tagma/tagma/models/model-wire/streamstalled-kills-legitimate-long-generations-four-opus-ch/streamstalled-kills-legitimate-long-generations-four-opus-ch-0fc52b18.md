---
id: 01a1062a-fca4-7858-b0c7-336f0fc52b18
title: "StreamStalled kills legitimate long generations: four Opus children at xhigh/high died at 300 s of silence on two providers"
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "StreamStalled now hits all three providers. darwin-impl (Astra, openai-oauth) reports that \"several writes were cut off mid-arguments\": the stall lands while a tool call's arguments are streaming. Over about 4 hours every child was continued by hand 8–10 times.",
    "command": "The same stack of children, now spread over openai-oauth (Sol, Astra)",
    "expected": "Streams on separate providers do not stall together"
  }
---
Filed from project `runlith`.