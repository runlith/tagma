---
id: 01a1124d-b081-7dd0-a9ad-b14a3772fbd8
title: "Rename the remaining \"activity\" names with other meanings: CallActivity, CommandActivity, WorktreeActivity, the 'activity' hook occasion, lastActivityAt"
ord: 21
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a111c0-a6a5-7a73-8f4d-f9f23b1981ef
---
After the activity record arrived, the word in these names reads as it, although it means something else: tool-call progress (`CallActivity`, `native-harness/calls/activity.ts`), command liveness (`CommandActivity`), worktree progress (`WorktreeActivity`), the external-harness hook occasion (`occasion: 'activity'`), and the last-observation time (`lastActivityAt`). Task 3b1981ef renamed what it touched (`ToolCallIdentity.progress`, compaction `entry` records) and left these names: they travel over the wire into the app and hook protocols, and renaming is a separate migration of data and contracts.

Done when each name is replaced with a truthful word in server, agent, and wire, stored data is migrated, and timeline names in chat-ui are untouched.
