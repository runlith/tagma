---
id: 01a1ac92-4569-7c5f-8043-546eecf34cce
title: Delegation, sub-agent model, review and capability notices name who made the change
ord: 74
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1ac7e-8191-76d6-b37d-b4c36c82ecc6",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-632c6aeb5d45
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/delegationRule.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/teamRule.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/availability.ts
---
Instruction-change notices name their actor from the graph journal since `2e466f266e`. The other runtime notices about changed state still name none, or guess one:

- **Delegation** — `delegationNotice` (`packages/agent/src/collaboration/CollaborationVoice.ts`), sent by `delegationRule`, says "The operator switched delegation …" although `set_thread_delegation` is also a thread tool and the machine switch is a setting any writer may set. `ThreadAdjustments.setDelegation` keeps no record of who switched, so the actor has to be recorded with the switch before the notice can name it.
- **Sub-agent models and review policy** — `teamRule` (`native-harness/turns/teamRule.ts`) says "Sub-agent models … now" and the review words with no actor. `agent.models` and `agent.review` record their writer (`Settings.read(…).writer`, `setting.session_id`). A connected-account change has no actor record.
- **Capability switches** — `availability.ts` says "… are no longer offered: <setting> is off." with no actor, while the switching setting records its writer.

Done when each of these notices names `operator`, the acting thread or `you` from the record that produced the change, a change with no record (a provider sign-in) names nobody, and a test through the beforeStep rule shows the operator's switch and another thread's switch named.
