---
id: 01a17b24-f4a5-74f8-93d2-16018df0e4bf
title: Check_rules and inspection-key reads take HEAD and the config cache site with one git
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17ad9-64cb-7877-b99c-2baf36b8a082",
    "status": "closed"
  }
---
Pass the already jointly read commonDir into ConfigVersion for check_rules and keyed read_inspections, instead of a repeated Configs.storeFile. Keep the old fallback on an unsupported or unparsable git answer, the earlier refusals and HEAD check order; measure the cut on the existing public contracts with no test changes for the count.
