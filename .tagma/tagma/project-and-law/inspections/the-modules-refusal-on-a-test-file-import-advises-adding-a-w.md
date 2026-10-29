---
id: 01a164f1-fc40-73ec-8f3f-c3f4ac2867a2
title: The modules refusal on a test-file import advises adding a working relation, and set_module will not record a tests-only relation as a cycle
ord: 51
tags: ["reflection"]
fields:
  {
    "actual": "fix: 'add the relation `domain → ui` with set_module' — opens domain's working code to ui; set_module importsTests → refused inspection-failed 'relations close a cycle, `domain` -> `ui` -> `domain`'",
    "command": "law-lab: packages/domain/tests/rates.test.ts imports @law-lab/ui (ui → domain already there); submit_work → fix; then set_module domain importsTests put ui",
    "expected": "fix for a test file names `imports-tests` (a test-code-only relation); set_module records domain imports-tests ui — a test relation makes no working-relations cycle"
  }
---
Filed from project `runlith`.

The `tests: ['.test']` config — the inspection knows the file is a test one (the fingerprint distinguishes anyway). An agent reading the fix widens the working code boundary — exactly what the rule forbids. Cycle: read_inspections modules says "Cycles are judged on the relations" and includes imports-tests; the typical case — a lower package's integration test through the upper — cannot be recorded without `cycles: allow` for the whole project. Experiment: step 16 under b85acc68.
