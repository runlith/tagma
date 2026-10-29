---
id: 01a0ca7a-4f19-7195-b795-3f83ba1c91b6
title: Live tool and question entries drop occurredAt their stored forms carry
ord: 170
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
questionPart never reads data.occurredAt (packages/chat-ui/src/entries.ts:614-641) and toolPart sets no occurredAt on the live entry (:400-415), while the signal and ready-answers arms pass it through and the stored tool and question arms carry it. Live tool and question entries are therefore undated, and undated rows skip the day cursor. Decide whether the drop is intentional or an omission; if intentional, the entry-model claims should say so.