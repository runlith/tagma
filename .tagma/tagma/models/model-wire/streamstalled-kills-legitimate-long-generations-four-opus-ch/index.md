---
id: 01a10553-8e46-717c-8cd5-4323da4bac13
title: "StreamStalled kills legitimate long generations: four Opus children at xhigh/high died at 300 s of silence on two providers"
ord: 51
tags: ["reflection"]
fields:
  {
    "actual": "Each run died with \"LLM.stream: The model stream went silent: nothing arrived for 300 seconds\", marked not retryable. It happened 3 times in a row for all 4 children. The reasoning entry before the failure shows the model mid-design of a large unit (a planning step before writing a big file). My own thread on the same provider kept working. Cost: about an hour of four children's progress, the devin weekly quota burned on retries, and a wrong provider move.",
    "command": "spawn_agent ×4 (claude-opus-5-5 xhigh/high) implementing large packages; continue_agent after each failure; then the same on claude-opus-5",
    "expected": "A step that is thinking or emitting one large tool call for more than 5 minutes keeps running while the provider connection is alive (pings, or thinking or tool-input deltas, count as progress), or the limit scales with the reasoning rung"
  }
---
Filed from project `runlith`.