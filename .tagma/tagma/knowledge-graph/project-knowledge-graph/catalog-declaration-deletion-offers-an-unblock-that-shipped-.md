---
id: 01a183c4-217f-75b3-bdb9-336b5bceacd1
title: Catalog declaration deletion offers an unblock that shipped membership refuses
ord: 243
tags: ["reflection"]
fields:
  {
    "actual": "delete_block refused[catalog-member] and instructed dropping the declaration from catalog.tags; that update refused[operation-only] and instructed keeping the same declaration because it shipped in core. No deletion path remains without deleting unrelated catalog content.",
    "command": "delete_block({project:7,blockId:\"0d0399c9\"}); update_block({project:7,blockId:\"3aa0f708\",fields:{tags:[\"b83d0aa0\",\"49296541\"]}})",
    "expected": "An explicitly authorized deletion of an obsolete shipped tag declaration has an executable unblock that retains the catalog and all unrelated declarations."
  }
---
Filed from project `tagma`.