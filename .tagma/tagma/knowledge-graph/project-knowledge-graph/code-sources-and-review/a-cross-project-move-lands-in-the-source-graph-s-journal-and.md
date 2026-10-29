---
id: 01a1823f-c8da-7004-933e-00d65a397826
title: A cross-project move lands in the source graph's journal and commit as "delete" of a name no block carries
ord: 14
tags: ["reflection"]
fields:
  {
    "actual": "Journal event 8249 and graph commit 7ee5cb8b read \"delete a23876e8 Code in archive/ is frozen…\"; no block in either project is named a23876e8, and nothing says the block moved.",
    "command": "update_block blockId=0eee02db project=tagma parentId=a941dfc7 (a block of project runlith)",
    "expected": "The tagma journal and its graph commit say the rule 0eee02db moved to project runlith."
  }
---
Filed from project `tagma`.

Seen in the stealth tree of project 5 (`~/.tagma-dev/graphs/5/trees/tagma-d71fe4b2033d6218`), commit `7ee5cb8b` `docs(graph): delete rule`, body `delete a23876e8 …`, trailer `Tagma-Graph: 8249`. `read_events project=tagma sinceId=8247` answers `8249 delete a23876e8`. The block stands in runlith as `0eee02db` (full id `01a104dd-0d00-7970-b1dc-0cc20eee02db`); `search_blocks a23876e8` finds nothing in runlith. The same act line reaches the public history once the graph is team storage, so a reader of `runlith/tagma` sees a deletion of an unknown block where a block left for another project. The p4-root agent's nine moves to runlith (`261dfb2d`) earlier the same day went through the same door.