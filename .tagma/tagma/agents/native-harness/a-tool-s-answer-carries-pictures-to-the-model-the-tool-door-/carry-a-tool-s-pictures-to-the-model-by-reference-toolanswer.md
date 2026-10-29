---
id: 01a0db92-3b40-7b46-be6f-1e4042e35b15
title: "Carry a tool's pictures to the model by reference: ToolAnswer media, the door's keeping, tool-result hydration, the vision strip, picture price, read on images and the tool row"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0db83-ef63-7ba3-8928-1f42ad36ec89",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0db91-a95d-7cbe-b90b-800107b62a24
---
Build §4.1–§4.7 of [[07b62a24|the decision]]: the tool contract's `media`, the door that normalizes and keeps pictures by reference, the attachment port's `keep` and tool-result hydration (Tagma's `ThreadAttachmentStore` included), the strip for rows without vision in `ModelRequests`, picture price in `estimateThreadTokens` and pruning's weight, `read` answering images by signature, the display's `images` and the chat tool row drawing them.

Start at `ToolAnswer` in `packages/agent/src/agent/tool.ts`, the door's `project` in `AgentToolDoor.ts` and `agentToolModelOutput` in `ToolOutput.ts`; the other roads into the model are `ThreadEffectSettlement` and `ThreadQuestion`. The thread composes the door's output port in `ThreadRunStarter` beside the attachment port.

Done when the §7 criteria that do not name MCP or webfetch hold, the affected claims of §8 are reconciled from the code, and the typecheck and the touched suites pass.
