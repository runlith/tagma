---
id: 01a128e8-97dd-7a10-8044-6b97377d02fb
title: submit_work reports lines left in a file whose diff against HEAD is empty
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "`left` named apps/tagma/server/drizzle/20261011024939_fast_status_split/{migration.sql,snapshot.json} as \"lines of this session still stand uncommitted\". These files were generated, moved away with the rename tool and their folder removed; the folder does not exist and git status shows nothing for it.",
    "command": "submit_work paths=[apps/tagma/server/drizzle/20261011043000_fast_status_split, …] → 49395e0a36",
    "expected": "`left` names no path that exists neither on disk nor in git"
  }
---
Filed from project `runlith`.