---
id: 01a18a46-b64d-77c9-b691-13bbdfe3761e
title: Persisted run readings still discard a defect stack
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "The public read_thread regression returned HTTP 200 but omitted stack; 0 pass, 1 fail, 26 filtered, 9.41 s. persisted.ts duplicates ThreadFailureDiagnostics without stack, and protocol/http consumes that copy.",
    "command": "testbed bun test --no-isolate --randomize --seed=1 --test-name-pattern 'a stored defect stack' ./src/composition/testing/native-harness/evidence.itest.ts",
    "expected": "read_thread select runs and the thread shape retain the stored TypeError stack alongside the transcript-owned diagnostics."
  }
---
Filed from project `tagma`.

The original failure-entry path now keeps stack. This remaining durable run path still strips it through parseThreadRunFailure. Red report: /tmp/runlith-test/reports/run.75766.1793321219474.jsonl. Task 1748f54a is held by this session and fixes the shared diagnostics owner rather than adding a consumer fallback.