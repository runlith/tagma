---
id: 01a1321a-e7bb-77e3-9832-826f55abc971
title: submit_work spends ~50 s re-reading 235 MB of change-record text on every large-file-set landing
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "54.3 s to a rule-violated refusal; the same session's two previous attempts took 53.5 s and 52.2 s. Holdings.rows is one 8.8 s SQL select (exec 4.6 s), another 3.7 s re-judging when the lease is released; WorkspaceChangeLog.evidenceOfPlaces ×9 ≈ 10.5 s; prepared.shape 11 s; enforcement 13.6 s.",
    "command": "submit_work (thread 01a131e0-b982-7d44-89cd-2753351ca61b, tool:toolu_01Pwd5WagHSqH1YSRmFoWuaG, whole: true, ~170 paths)",
    "expected": "Commit preparation and the rules judgement take seconds; cost grows with changed lines, not with the full volume of held-file texts."
  }
---
Span tree: submit_work 19c358628bd20df8 → submitWork.commit 50.4 s = prepared.prepare 36.5 s (build 24.7 + shape 11.0) + submit_work.before 13.7 s (enforcement.judgement).

Holder 01a131e0… holds 637 standing workspace_change lines on 521 paths; old_text+new_text total 235 MB.

`rowsAt` (apps/tagma/server/src/change-record/holdings/inputs.ts) selects old_text/new_text of every standing line of the paths, although the probe key `rowsKey` is built only from id/state/afterHash/kept. `evidenceOfGroup` (apps/tagma/server/src/change-record/record/evidence.ts) selects the same lines again and pulls versionTexts by digest, through `store.db` directly rather than `units.read`. Finding (not measured per piece): texts are read and copied whole on every judgement, even when the probe key has not changed.
