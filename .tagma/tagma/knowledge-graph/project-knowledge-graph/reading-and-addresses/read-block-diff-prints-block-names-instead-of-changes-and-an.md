---
id: 01a15167-b002-7dae-bfae-328fed67a364
title: read_block_diff prints block names instead of changes and an "of undefined" footer
ord: 11
tags: ["reflection"]
fields:
  {
    "actual": "The answer holds only \"842e3529 [#spec/open] Цепочка миграций начинается с одной базовой; существующие хранилища переводятся на неё один раз\" and \"1 of undefined\", with no diff or explanation.",
    "command": "read_block_diff({\"project\":\"runlith\",\"blockId\":\"842e3529\",\"since\":\"2026-10-18T22:00:00Z\"})",
    "expected": "The read returns the block body and property changes over the period, or explicitly reports no changes."
  }
---
Filed from project `runlith`.

In a read-only review the same result came back for f8616748 (2 of undefined), 8d4a4eb8 (2 of undefined), e7b7be7f (3 of undefined), and 4581b954 (1 of undefined). The full current bodies were read separately; this operation did not establish the graph changes over the period.
