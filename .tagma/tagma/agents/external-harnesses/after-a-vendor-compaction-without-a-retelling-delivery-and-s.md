---
id: 01a1976a-d18e-7525-875d-c6561c26d1ef
title: After a vendor compaction without a retelling, delivery and skills still count pre-boundary payloads as visible
ord: 211
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19562-2e91-73bd-ba7a-b645f8ba09ee",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a19561-644d-76b1-8079-9c247761ae92
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/journal.ts
---
A hosted compaction whose vendor gives no retelling (Muse Code) now leaves Tagma's model history whole, so fork, rewind and model moves rebuild from the full journal. The same history also answers "what the model still sees": the context sections a turn already delivered count as heard (`turns/message.ts`, `WorldState.ts` suppresses re-delivery), and `AgentSkill` finds earlier skill payloads, so `load_skill` answers already loaded. After the vendor compacted, both can be false: the vendor's session no longer holds those sections or skill bodies verbatim. Found by source reading in review of the Muse runner; not measured live.

Record the vendor-visible boundary apart from the retained history — the compaction boundary already stands in the journal — and have delivery and skill visibility read from that boundary, while fork, rewind and model moves keep reading the whole history. A test compacts with an empty retelling, then runs an unchanged turn (world state is delivered again) and reloads a skill (its payload is sent again), and checks the retained history is intact.
