---
id: 01a172fb-3583-7cc4-9695-fd7324e6b6b0
title: Check the stale load_skill catalog after removing ag-no-shit-tests
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a16e6b-8c2f-7df9-a39a-fec293923d2e
---
In the [[01a16dee-2ab6-7368-a8dd-8e28322636c7|source thread]] the run started 2026-10-24 at 14:23Z, `tests` was installed at 14:50Z (`36d0a29f15`), and #2716 at 14:57Z got an ENOENT of the old path; #2857 of the next run at 15:07Z loaded `tests`. The exact time the personal file was deleted is not established. `WorkspaceInputs.resolve` holds the found set per run/generation, while `asAgentSkills.currentBody` re-reads the body by the stored path: an external file deleted after the scan can still yield that ENOENT. The new enum does not mean the cause is gone. The related unambiguous `skills.disabled` bug is fixed in `35291870b5`: the mask is current via `Settings.held`, its revision changes the active run's catalog, and the notification arrives through the regular beforeStep. The red hosted-refresh scenario expected an empty catalog and got `[load_skill,publish_artifact]`; after the fix library/cache pass 19/19 on seeds 1/2/3, overall server typecheck exit 0. An independent review of the finished code reached no findings; the [[0bb6f81f|skills contract]] is updated. A product boundary remains: `skills.rescan` sets the discovery time of catalogs and instruction files, but not body re-reading at load; the [[09e5d6f9|next-step norm]] holds no exception for files. Should external skill addition or removal change the active run's catalog on the next step regardless of `skills.rescan`, or does file discovery deliberately wait for the chosen rescan? Recommendation — a next step with an explicitly agreed per-turn/manual meaning; the law and the setting are unchanged so far. The source reflection remains unanswered: the current cache lifetime test confirms that a bound run keeps its discovered sources after invalidation, so deleting a stored skill path can still make load_skill return a read error until discovery runs again. The narrower same-turn reference-section defect was independently reproduced through load_skill and fixed by [[b0cf9821]] in d2c1fe6009; it does not change this catalog addition/removal boundary.
