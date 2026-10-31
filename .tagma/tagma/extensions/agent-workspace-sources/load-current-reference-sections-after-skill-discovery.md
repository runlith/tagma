---
id: 01a19400-6ca6-7831-99ec-fe99b0cf9821
title: Load current reference sections after skill discovery
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a193f6-f75f-7249-8b8f-36444a9361c0",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a185bb-fbfa-7a6b-bde8-4c8b45b4288b
---
load_skill now asks the skill producer for current named sections instead of resolving them through the discovery snapshot. The same-catalog public-tool regression first failed with 'Agent skill writer has no reference ios, stands: its references are measuring'; it now loads both newly created sections with the edited body and rejects a name outside the section namespace. sources.itest.ts passes 17/17 and AgentSkill.test.ts 10/10 on seeds 1, 2 and 3; both touched packages typecheck. Two existing library tests confirm skills.disabled still withdraws and restores skills in draft and active catalogs; the cache lifetime test confirms catalog discovery remains unchanged. No live product launch or wide test suite was run.