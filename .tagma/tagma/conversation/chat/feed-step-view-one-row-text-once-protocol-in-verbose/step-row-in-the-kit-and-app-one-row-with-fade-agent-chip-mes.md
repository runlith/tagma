---
id: 01a15509-b11a-75f6-8eb0-3fce621084ce
title: "Step row in the kit and app: one row with fade, agent chip, message preview, verbose for protocol"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a154fa-d3bc-7a25-8e12-350dc1e6c60b",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15505-e84f-704a-8ac7-db7516b0175d
---
Per [[16b0175d]]: `ActivityStep`, `ToolRow`, `ToolXRay`, `CompactionRow`, `activity.ts`, `strings.ts` in `packages/chat-ui`; `activityIdentity.ts`, `native/strings.ts`, and the demo scene in the app. Proof is typecheck, kit tests, demo build.
