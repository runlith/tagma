---
id: 01a127cb-a395-7544-8990-50c965adb6bb
title: submit_work lists deleted temporary files in left with zero holdings
ord: 19
tags: ["reflection"]
fields:
  {
    "actual": "The answer named left for the formerly deleted migration.sql, bench-transitions.ts, check-transitions.ts, and packages/performance/check-schema.ts. A subsequent read_changes on each answers 'no line differs from HEAD'; the overall read_changes — 0 held paths; git diff/status of the four paths empty. In turns the deleted check-schema.ts is also marked held.",
    "command": "submit_work(subject='Recreate telemetry storage when its schema changes', paths=[8 performance paths]) → 05d3059ac4; then read_changes on each left path and git diff/status.",
    "expected": "left lists only paths where this session's lines truly remain unlanded."
  }
---
