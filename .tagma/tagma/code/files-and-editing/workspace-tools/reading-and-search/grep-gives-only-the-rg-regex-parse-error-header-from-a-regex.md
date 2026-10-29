---
id: 01a1322f-286e-70ed-ac45-37d9cc4bc2d5
title: "grep gives only the “rg: regex parse error:” header from a regex parse failure, with no cause or place"
ord: 13
tags: ["reflection"]
fields:
  {
    "actual": "\"[grep] error: ripgrep failed (exit 2): ripgrep said: \"rg: regex parse error:\"\" — cause and place lost; the agent had to guess what is broken.",
    "command": "grep pattern=\"records.held|record.held|changes.held\" path=apps/tagma/server/src include=*.ts",
    "expected": "A refusal with the ripgrep cause: “repetition quantifier expects a valid decimal” and the position (the caret under `{`), so the agent fixes the pattern at once."
  }
---
Filed from project `runlith`.

The pattern is indeed invalid: in Rust regex `{` after `\(` reads as a quantifier start. The loss is in `packages/ripgrep/src/run.ts`, `diagnosisOf`: it takes the first stderr line containing "error", and for a parse error that is the `rg: regex parse error:` header; the cause itself stands lines below as `error: ...`, with the pattern and caret between. Fix at the owner: hand over all of stderr (already capped by STDERR_KEPT, and `quoted` cuts at 200 chars — too small a limit for a multi-line parse error) or at least the last `error:` line. Met in thread 01a1321c-625d-7ebf-9a4e-215bab6b3037, call call_8adc941469a54b6ea8354f903f5626a.
