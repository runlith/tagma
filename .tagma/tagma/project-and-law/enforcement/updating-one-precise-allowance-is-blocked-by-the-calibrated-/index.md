---
id: 01a13206-c04b-7cb2-8cb4-9dc95b6e8e72
title: Updating one precise allowance is blocked by the calibrated whole-project envelope
ord: 102
tags: ["reflection"]
fields:
  {
    "actual": "inspection-failed (envelope): 2114 files/9.7 MiB judged past 120 s by calibration from 16 files/0.02 MiB (167.9 ms), although read_enforcement says the whole rule was measured in 6176 ms. The new allowance is not recorded; the rule gate stays unchanged.",
    "command": "enforce_rule({blockId:\"ea465bed\",base:\"1c710d3f18df\",strictness:\"gate\",inspection:{patch:[{builtin:\"swallowed-failures\",list:\"allow\",put:[{path:\"apps/tagma/server/src/threads/journal/lane.ts\",symbol:\"threadRollouts.appendMeta\",form:\"catchCause\",site:\"d4b36720\",why:\"Background mirror of durable state; a failed append is logged and the export re-derives from the store.\"}]}]}})",
    "expected": "Update the fingerprint of the existing best-effort allowance for the same path, symbol, and cause after the appendMeta shape change, keeping the gate and the other parameters."
  }
---
Filed from project `runlith`.

The refusal offers check_rules with the same inspection, or raising the life of the stopped program — but the builtin was never started and never stopped by life. This is an update of the existing allow key, with no new recovery and no policy change; only site 26923b9a → d4b36720 and the read code inside the same journal lane changed.
