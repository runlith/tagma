---
id: 01a1090e-81d8-7ee1-882f-e28e3dd75106
title: set_module refuses to remove a module whose only child is in the trash, and delete_block refuses the card
ord: 19
tags: ["reflection"]
fields:
  {
    "actual": "module-shape: \"holds 1 block(s); move or delete them before the module\" — the trashed rule (deletedAt set, parentName still ff4d995b) is counted. delete_block ff4d995b refuses operation-only and points back to set_module. No road removes the card without restoring and moving the trashed child first.",
    "command": "set_module {modules:[{id:\"@runlith/floating-frame\", remove:true}]} after delete_block 2bbe9533 (the card's only child)",
    "expected": "The card is removed: its only child was already trashed, as the refusal's own words (\"move or delete them\") asked."
  }
---
Workaround path tried: restore_block 2bbe9533, then move and delete it. The restore and set_module ran concurrently (my calls were issued in parallel): set_module succeeded and trashed ff4d995b while the restored rule stood under it with deletedAt null — a standing block under a trashed parent, readable by search and refusing update_block ("ff4d995b is in the trash"). delete_block 2bbe9533 cleared it. Two defects: trashed children count as held for set_module's module-shape gate, and set_module's remove does not re-check children at commit against a concurrent restore.